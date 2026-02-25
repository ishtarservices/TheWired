import type { NostrEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";
import { parseProfile } from "../../features/profile/profileParser";
import { getProfile, putProfile } from "../db/profileStore";
import { relayManager } from "./relayManager";

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
  private batchScheduled = false;

  /** Get cached profile synchronously (returns null if not cached) */
  getCached(pubkey: string): Kind0Profile | null {
    return this.cache.get(pubkey)?.profile ?? null;
  }

  /**
   * Subscribe to a pubkey's profile.
   * - Returns cached value immediately via listener if available
   * - Loads from IDB if not in memory
   * - Batches relay fetch with other subscribe() calls in the same microtask
   * - Returns unsubscribe function
   */
  subscribe(pubkey: string, listener: ProfileListener): () => void {
    // Register listener
    if (!this.listeners.has(pubkey)) {
      this.listeners.set(pubkey, new Set());
    }
    this.listeners.get(pubkey)!.add(listener);

    // Immediately notify with cached data
    const cached = this.cache.get(pubkey);
    if (cached) {
      listener(cached.profile);
    }

    // Load from IDB if not in memory cache
    if (!cached) {
      getProfile(pubkey).then((idbProfile) => {
        if (!idbProfile) return;
        // Only use IDB data if we still don't have anything newer in memory
        const current = this.cache.get(pubkey);
        if (!current || (idbProfile.created_at && (!current.created_at || idbProfile.created_at > current.created_at))) {
          this.cache.set(pubkey, {
            profile: idbProfile,
            created_at: idbProfile.created_at ?? 0,
          });
          this.notifyListeners(pubkey, idbProfile);
        }
      });
    }

    // Schedule relay fetch
    this.pendingBatch.add(pubkey);
    this.scheduleBatch();

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
   * Applies created_at freshness guard, updates cache, persists to IDB, notifies listeners.
   */
  handleProfileEvent(event: NostrEvent): void {
    if (event.kind !== 0) return;

    const existing = this.cache.get(event.pubkey);
    if (existing && event.created_at <= existing.created_at) {
      return; // Reject stale
    }

    const parsed = parseProfile(event);
    if (!parsed) return;

    this.cache.set(event.pubkey, {
      profile: parsed,
      created_at: event.created_at,
    });

    this.notifyListeners(event.pubkey, parsed);
    putProfile(event.pubkey, parsed);
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

  /** Clear the entire cache (used on logout) */
  clear(): void {
    this.cache.clear();
    this.listeners.clear();
    this.pendingBatch.clear();
  }

  private notifyListeners(pubkey: string, profile: Kind0Profile): void {
    const set = this.listeners.get(pubkey);
    if (!set) return;
    for (const listener of set) {
      listener(profile);
    }
  }

  private scheduleBatch(): void {
    if (this.batchScheduled) return;
    this.batchScheduled = true;
    // Use queueMicrotask so all subscribe() calls in the same render tick batch together
    queueMicrotask(() => this.flushBatch());
  }

  private flushBatch(): void {
    this.batchScheduled = false;
    if (this.pendingBatch.size === 0) return;

    const pubkeys = [...this.pendingBatch];
    this.pendingBatch.clear();

    // Track EOSE from each relay to auto-close
    const readRelays = relayManager.getReadRelays();
    const eoseCount = { current: 0 };
    const totalRelays = readRelays.length;

    const subId = relayManager.subscribe({
      filters: [{ kinds: [0], authors: pubkeys }],
      onEvent: (event) => {
        this.handleProfileEvent(event);
      },
      onEOSE: () => {
        eoseCount.current++;
        if (eoseCount.current >= totalRelays) {
          relayManager.closeSubscription(subId);
        }
      },
    });
  }
}

/** Singleton profile cache */
export const profileCache = new ProfileCacheImpl();
