import type { NostrEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";
import { parseProfile } from "../../features/profile/profileParser";
import { getProfile, putProfile } from "../db/profileStore";
import { relayManager } from "./relayManager";
import { PROFILE_RELAYS } from "./constants";
import { createLogger, shortKey, shortRelay } from "../debug/logger";
import {
  trackRequest,
  markIdb,
  markBatch,
  markResolved,
  markTimeout,
  resetProfileTracker,
} from "../debug/profileTracker";
import { batchProfiles, cachedProfileToKind0 } from "../api/profiles";

const log = createLogger("profile");

/** Resolution source for the profile tracker. */
type ProfileSource = "memory" | "idb" | "relay" | "backend";

/** Display name for logging/tracking; falls back to nothing if unnamed. */
function profileName(p: Kind0Profile | null | undefined): string | undefined {
  return p?.display_name || p?.name || undefined;
}

let batchCounter = 0;

/** Coalesce profile requests across renders into one REQ. Short enough to feel
 *  instant to the user, long enough to capture a same-render burst (a typical
 *  feed/profile mount triggers all useProfile() calls within ~10–20 ms).
 *  Was 250 ms — added ~250 ms to every uncached profile fetch for no real gain. */
const BATCH_DEBOUNCE_MS = 50;
/** After a profile fails to resolve, suppress refetch for this long (stops the storm
 *  where an unresolvable pubkey is re-requested on every render). */
const NEG_CACHE_MS = 20_000;
/** Max time a batch stays open waiting on slow/late relays before giving up.
 *  Most fast-responder relays answer in <500 ms; if nothing came back in 2.5 s,
 *  the additional wait isn't producing data worth blocking the UI for. */
const BATCH_TIMEOUT_MS = 2_500;
/** Backend (L3) batch endpoint cap — POST /profiles/batch enforces ≤50. */
const BACKEND_CHUNK = 50;
/** Bound on the backend HTTP wait. A reachable backend responds in <100 ms; if it
 *  doesn't, the worst thing we can do is hang the UI on it — fall straight through
 *  to relays. Was 3000 ms which dominated latency when the backend was flaky. */
const BACKEND_TIMEOUT_MS = 800;

interface CacheEntry {
  profile: Kind0Profile;
  created_at: number;
}

type ProfileListener = (profile: Kind0Profile) => void;

/**
 * Global profile cache singleton.
 * - In-memory cache with created_at freshness guards
 * - Microtask-batched relay subscriptions (many pubkeys → one REQ)
 * - IDB fallback for instant display
 * - EOSE auto-close
 */
class ProfileCacheImpl {
  private cache = new Map<string, CacheEntry>();
  private listeners = new Map<string, Set<ProfileListener>>();
  private pendingBatch = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pubkeys with an open relay REQ — don't re-batch them while in flight. */
  private inFlight = new Set<string>();
  /** pubkey → ms of last failed fetch; suppresses refetch storms for missing profiles. */
  private failedAt = new Map<string, number>();
  /** Pubkeys with an in-flight IDB read — coalesces the burst of subscribe()
   *  calls a profile page fires for one author (N notes → 1 read, not N). */
  private idbInFlight = new Set<string>();

  /** Get cached profile synchronously (returns null if not cached) */
  getCached(pubkey: string): Kind0Profile | null {
    return this.cache.get(pubkey)?.profile ?? null;
  }

  /** Whether this pubkey needs a relay fetch (not cached, not in flight, not recently failed). */
  private shouldFetch(pubkey: string): boolean {
    if (this.cache.has(pubkey)) return false;
    if (this.inFlight.has(pubkey)) return false;
    const failed = this.failedAt.get(pubkey);
    if (failed !== undefined && Date.now() - failed < NEG_CACHE_MS) return false;
    return true;
  }

  /**
   * Subscribe to a pubkey's profile.
   * - Returns cached value immediately via listener if available
   * - Loads from IDB if not in memory
   * - Batches relay fetch with other subscribe() calls in the same microtask
   * - Returns unsubscribe function
   */
  subscribe(pubkey: string, listener: ProfileListener): () => void {
    trackRequest(pubkey);

    // Register listener
    if (!this.listeners.has(pubkey)) {
      this.listeners.set(pubkey, new Set());
    }
    this.listeners.get(pubkey)!.add(listener);

    // Immediately notify with cached data. (No per-hit log — a profile page with N
    // notes by one author fires this N times; it drowns the signal. The tracker
    // still records the resolution for wiredDebug.profiles().)
    const cached = this.cache.get(pubkey);
    if (cached) {
      markResolved(pubkey, "memory", profileName(cached.profile));
      listener(cached.profile);
    }

    // Load from IDB ONCE per in-flight pubkey. A profile page fires subscribe()
    // once per note by the same author; coalescing collapses that burst into a
    // single IDB read — every registered listener is notified when it resolves
    // (ingestProfile → notifyListeners), so no card misses out.
    if (!cached && !this.idbInFlight.has(pubkey)) {
      this.idbInFlight.add(pubkey);
      log.debug(`subscribe ${shortKey(pubkey)} → not cached, loading IDB + scheduling relay fetch`);
      const idbStart = performance.now();
      getProfile(pubkey).then(
        (idbProfile) => {
          this.idbInFlight.delete(pubkey);
          const ms = performance.now() - idbStart;
          if (!idbProfile) {
            // miss vs stale are indistinguishable here (getProfile returns undefined
            // for both), but it tells us IDB had nothing usable.
            markIdb(pubkey, "miss", ms);
            log.debug(`IDB ${shortKey(pubkey)} → miss/stale (${ms.toFixed(0)}ms) — needs relay`);
            return;
          }
          markIdb(pubkey, "hit", ms);
          // Reconcile through the shared guard — won't overwrite a fresher in-memory value.
          const applied = this.ingestProfile(pubkey, idbProfile, idbProfile.created_at ?? 0, { source: "idb" });
          log.debug(
            `IDB ${shortKey(pubkey)} → hit (${profileName(idbProfile) ?? "unnamed"}, ${ms.toFixed(0)}ms)${applied ? "" : " but memory already fresher"}`,
          );
        },
        (err) => {
          this.idbInFlight.delete(pubkey);
          markIdb(pubkey, "error", performance.now() - idbStart);
          log.warn(`IDB ${shortKey(pubkey)} → error`, err);
        },
      );
    }

    // Schedule relay fetch — skip if cached, already in flight, or recently failed
    if (this.shouldFetch(pubkey)) {
      this.pendingBatch.add(pubkey);
      this.scheduleBatch();
    }

    return () => {
      const set = this.listeners.get(pubkey);
      if (set) {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(pubkey);
        }
      }
    };
  }

  /**
   * Handle an incoming kind:0 event from any source (pipeline or own subscription).
   * Parses the event and reconciles it through the shared created_at guard.
   */
  handleProfileEvent(event: NostrEvent, relayUrl?: string): void {
    if (event.kind !== 0) return;

    const parsed = parseProfile(event);
    if (!parsed) {
      log.warn(`kind:0 ${shortKey(event.pubkey)} parse FAILED — content not valid JSON profile`, {
        relay: relayUrl ? shortRelay(relayUrl) : undefined,
        contentPreview: typeof event.content === "string" ? event.content.slice(0, 120) : event.content,
      });
      return;
    }

    this.ingestProfile(event.pubkey, parsed, event.created_at, { source: "relay", relayUrl });
  }

  /**
   * Single reconciliation point for every tier (relay, backend, IDB, own kind:0).
   * Applies the created_at version guard — a lower-or-equal created_at NEVER
   * overwrites a higher one, regardless of which tier or arrival order it came
   * from. On accept: updates the in-memory cache, clears in-flight/negative-cache
   * state, notifies listeners, and persists to IDB (with the version attached).
   *
   * @returns true if the profile was applied (incoming was newer), false if rejected as stale.
   */
  private ingestProfile(
    pubkey: string,
    profile: Kind0Profile,
    createdAt: number,
    opts?: { source?: ProfileSource; relayUrl?: string },
  ): boolean {
    const existing = this.cache.get(pubkey);
    if (existing && createdAt <= existing.created_at) {
      log.debug(
        `kind:0 ${shortKey(pubkey)} rejected as stale (incoming created_at=${createdAt} ≤ cached=${existing.created_at})`,
      );
      // It's still "resolved" — clear any in-flight/failed bookkeeping for it.
      this.inFlight.delete(pubkey);
      this.failedAt.delete(pubkey);
      return false;
    }

    const source = opts?.source ?? "relay";
    // Attach the version so IDB (and downstream consumers) carry it too.
    const stored: Kind0Profile = createdAt > 0 ? { ...profile, created_at: createdAt } : profile;

    log.debug(
      `kind:0 ${shortKey(pubkey)} accepted → ${profileName(stored) ?? "unnamed"} (${source}${opts?.relayUrl ? ` ${shortRelay(opts.relayUrl)}` : ""})`,
    );
    markResolved(pubkey, source, profileName(stored), opts?.relayUrl);

    this.cache.set(pubkey, { profile: stored, created_at: createdAt });
    this.inFlight.delete(pubkey);
    this.failedAt.delete(pubkey);

    this.notifyListeners(pubkey, stored);
    putProfile(pubkey, stored);
    return true;
  }

  /** Search cached profiles by name, display_name, nip05, or pubkey prefix */
  searchCached(query: string, limit = 10): Array<{ pubkey: string; profile: Kind0Profile }> {
    const q = query.toLowerCase();
    const results: Array<{ pubkey: string; profile: Kind0Profile }> = [];

    for (const [pubkey, entry] of this.cache) {
      if (results.length >= limit) break;

      const p = entry.profile;
      if (
        pubkey.startsWith(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.display_name?.toLowerCase().includes(q) ||
        p.nip05?.toLowerCase().includes(q)
      ) {
        results.push({ pubkey, profile: p });
      }
    }

    return results;
  }

  /**
   * Search within a specific set of pubkeys (e.g. space members).
   * Returns members matching the query first, then falls back to global cache.
   */
  searchScoped(query: string, scopedPubkeys: string[], limit = 8): Array<{ pubkey: string; profile: Kind0Profile }> {
    const q = query.toLowerCase();
    const results: Array<{ pubkey: string; profile: Kind0Profile }> = [];
    const seen = new Set<string>();

    // Phase 1: search within scoped pubkeys (include uncached members by pubkey prefix match)
    for (const pubkey of scopedPubkeys) {
      if (results.length >= limit) return results;
      const entry = this.cache.get(pubkey);
      const p = entry?.profile ?? {};

      if (
        pubkey.startsWith(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.display_name?.toLowerCase().includes(q) ||
        p.nip05?.toLowerCase().includes(q)
      ) {
        results.push({ pubkey, profile: p });
        seen.add(pubkey);
      }
    }

    // Phase 2: fill remaining slots from global cache
    if (results.length < limit) {
      for (const [pubkey, entry] of this.cache) {
        if (results.length >= limit) break;
        if (seen.has(pubkey)) continue;

        const p = entry.profile;
        if (
          pubkey.startsWith(q) ||
          p.name?.toLowerCase().includes(q) ||
          p.display_name?.toLowerCase().includes(q) ||
          p.nip05?.toLowerCase().includes(q)
        ) {
          results.push({ pubkey, profile: p });
        }
      }
    }

    return results;
  }

  /** Ensure profiles for a list of pubkeys are loaded into cache */
  warmPubkeys(pubkeys: string[]): void {
    const needed = pubkeys.filter((pk) => this.shouldFetch(pk));
    if (needed.length === 0) return;
    log.debug(`warmPubkeys: ${needed.length}/${pubkeys.length} need fetching`);
    for (const pk of needed) {
      trackRequest(pk);
      this.pendingBatch.add(pk);
    }
    this.scheduleBatch();
  }

  /** Clear the entire cache (used on logout) */
  clear(): void {
    log.debug(`clear() — dropping ${this.cache.size} cached profiles, ${this.listeners.size} listener sets`);
    this.cache.clear();
    this.listeners.clear();
    this.pendingBatch.clear();
    this.inFlight.clear();
    this.failedAt.clear();
    this.idbInFlight.clear();
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    resetProfileTracker();
  }

  private notifyListeners(pubkey: string, profile: Kind0Profile): void {
    const set = this.listeners.get(pubkey);
    if (!set) return;
    for (const listener of set) {
      listener(profile);
    }
  }

  private scheduleBatch(): void {
    if (this.batchTimer !== null) return;
    // Debounce (not microtask) so subscribe() calls across nearby renders coalesce
    // into ONE request with many authors, instead of one request per render.
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      void this.flushBatch().catch(() => {/* never throw to the timer */});
    }, BATCH_DEBOUNCE_MS);
  }

  private async flushBatch(): Promise<void> {
    if (this.pendingBatch.size === 0) return;

    // Drop any that resolved (e.g. from IDB) during the debounce window.
    const pubkeys = [...this.pendingBatch].filter((pk) => !this.cache.has(pk));
    this.pendingBatch.clear();
    if (pubkeys.length === 0) return;

    for (const pk of pubkeys) this.inFlight.add(pk);

    // L3 — backend profile cache first. Best-effort: on any failure we fall through
    // to relays for everything (unchanged behavior). The created_at guard keeps a
    // stale backend row safe (a newer relay event still wins). Backend hits with a
    // real version skip the relay fetch — that's the load-reduction win.
    let unresolved = pubkeys;
    try {
      const resolved = await this.fetchFromBackend(pubkeys);
      if (resolved.size > 0) unresolved = pubkeys.filter((pk) => !resolved.has(pk));
    } catch {
      // backend unavailable — relays handle all
    }

    // IDB-race re-check: the IDB lookups fired from subscribe() are async; if their
    // callbacks ran during our backend HTTP `await` (common when main thread frees
    // up mid-wait), the cache may now hold *versioned* profiles we were about to
    // relay-fetch. Without this, we'd send a 21-relay REQ for pubkeys we already
    // have locally. Legacy/created_at=0 entries (e.g. backend rows from before the
    // versioning migration) still get relay-revalidated — they're "painted" but
    // not "trusted."
    const wasPending = unresolved.length;
    unresolved = unresolved.filter((pk) => {
      const entry = this.cache.get(pk);
      return !entry || !entry.created_at;
    });
    if (unresolved.length < wasPending) {
      for (const pk of pubkeys) {
        const entry = this.cache.get(pk);
        if (entry && entry.created_at) this.inFlight.delete(pk);
      }
    }

    if (unresolved.length === 0) {
      log.debug(`profiles: all ${pubkeys.length} served from cache/backend (no relay fetch)`);
      return;
    }
    if (unresolved.length < pubkeys.length) {
      log.debug(
        `profiles: ${pubkeys.length - unresolved.length}/${pubkeys.length} from cache/backend; ${unresolved.length} → relays`,
      );
    }

    this.relayFetch(unresolved);
  }

  /**
   * L3: fetch profiles from the backend cache (POST /profiles/batch, chunked ≤50).
   * Ingests every returned profile through the version guard; returns the set of
   * pubkeys resolved with a real version (created_at > 0) — those skip the relay
   * fetch. Legacy rows (created_at 0/null) still paint but get relay-revalidated.
   */
  private async fetchFromBackend(pubkeys: string[]): Promise<Set<string>> {
    const resolved = new Set<string>();
    const chunks: string[][] = [];
    for (let i = 0; i < pubkeys.length; i += BACKEND_CHUNK) {
      chunks.push(pubkeys.slice(i, i + BACKEND_CHUNK));
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        batchProfiles(chunk, AbortSignal.timeout(BACKEND_TIMEOUT_MS))
          .then((r) => r.data)
          .catch(() => []),
      ),
    );

    let count = 0;
    for (const rows of results) {
      for (const row of rows) {
        const { profile, createdAt } = cachedProfileToKind0(row);
        this.ingestProfile(row.pubkey, profile, createdAt, { source: "backend" });
        if (createdAt > 0) resolved.add(row.pubkey);
        count++;
      }
    }
    if (count > 0) {
      log.debug(`backend cache returned ${count} profiles (${resolved.size} versioned)`);
    }
    return resolved;
  }

  /** L4: query relays for profiles the cache/backend couldn't resolve. */
  private relayFetch(pubkeys: string[]): void {
    const batchId = ++batchCounter;
    const batchStart = performance.now();

    // Hedge: query the profile indexers AND every connected read relay. A user's
    // kind:0 most often lives wherever their notes do — not only on the indexers —
    // so querying both is what actually resolves external profiles. (relayManager
    // strips indexer relays from non-profile subs, so kind:0 here is safe for them.)
    const connections = relayManager.getAllConnections();
    const readUrls = relayManager.getReadRelays().map((c) => c.url);
    const targets = [...new Set([...PROFILE_RELAYS, ...readUrls])];

    // Close once every relay that HAD the REQ at send time (connected) has EOSE'd —
    // never on the first EOSE, which previously let an empty local relay close the
    // batch before slower relays (indexers / damus) could answer.
    const connectedTargets = targets.filter(
      (u) => connections.get(u)?.getStatus() === "connected",
    );
    const eosed = new Set<string>();

    for (const pk of pubkeys) {
      markBatch(pk, batchId, targets.length, connectedTargets.length);
    }
    log.info(
      `batch #${batchId}: requesting ${pubkeys.length} kind:0 from ${connectedTargets.length}/${targets.length} connected relays (closes on all-EOSE or ${BATCH_TIMEOUT_MS / 1000}s)`,
    );

    let closed = false;
    const close = (reason: string) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      relayManager.closeSubscription(subId);

      const now = Date.now();
      const unresolved: string[] = [];
      for (const pk of pubkeys) {
        this.inFlight.delete(pk);
        if (!this.cache.has(pk)) {
          this.failedAt.set(pk, now); // negative-cache so we don't immediately refetch
          markTimeout(pk);
          unresolved.push(pk);
        }
      }
      const elapsed = (performance.now() - batchStart).toFixed(0);
      if (unresolved.length > 0) {
        log.warn(
          `batch #${batchId} ${reason}: ${pubkeys.length - unresolved.length}/${pubkeys.length} resolved in ${elapsed}ms — ${unresolved.length} unresolved (no relay had their kind:0; retry suppressed ${NEG_CACHE_MS / 1000}s)`,
          { unresolved: unresolved.slice(0, 8).map(shortKey) },
        );
      } else {
        log.debug(`batch #${batchId} ${reason}: resolved all ${pubkeys.length} in ${elapsed}ms`);
      }
    };

    const subId = relayManager.subscribe({
      filters: [{ kinds: [0], authors: pubkeys }],
      relayUrls: targets,
      onEvent: (event, relayUrl) => {
        this.handleProfileEvent(event, relayUrl);
        // Early close once every requested pubkey resolved — frees the sub slot fast.
        if (pubkeys.every((pk) => this.cache.has(pk))) close("all resolved");
      },
      onEOSE: (_subId, relayUrl) => {
        eosed.add(relayUrl);
        if (connectedTargets.length > 0 && connectedTargets.every((u) => eosed.has(u))) {
          close("EOSE from all connected relays");
        }
      },
    });

    // Backstop: close after the timeout even if some relays never EOSE.
    const timer = setTimeout(() => close("timeout"), BATCH_TIMEOUT_MS);
  }
}

/** Singleton profile cache */
export const profileCache = new ProfileCacheImpl();
