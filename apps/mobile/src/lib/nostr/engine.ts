// ─── Mobile Nostr engine ─────────────────────────────────────────────
// Small glue layer between the relay pool, the adapters and Redux — the
// mobile-local stand-in for the desktop eventPipeline until @thewired/core
// lands (Phase 0). Owns: dedup → verify → route, SQLite write-through +
// cold-start hydration, the feed/profile subscriptions, publishing, and the
// lifecycle edges (suspend/resume with fresh `since`).

import { KIND_GIFT_WRAP } from "@thewired/core";
import { getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import type { NostrEvent, NostrFilter, UnsignedEvent } from "@thewired/shared-types";

import { createDmEngine, type DmEngine } from "./dmEngine";
import { createRelayPool, type RelayPool } from "./relayPool";
import { parseProfile, type ProfileMetadata } from "./profiles";
import type { KVStore, PlatformAdapters, SignerAdapter } from "@/core/adapters";
import type { AppDispatch, RootState } from "@/store";
import {
  feedEventsReceived,
  feedHydrated,
  feedStatusChanged,
} from "@/store/slices/feedSlice";
import { profileReceived, profilesHydrated } from "@/store/slices/profilesSlice";
import { setRelayStatus } from "@/store/slices/relaysSlice";
import { zapReceiptSeen } from "@/store/slices/zapsSlice";

/** 3 sockets max on mobile — battery discipline (guide 06 §3). */
export const DEFAULT_RELAYS = [
  "wss://relay.thewired.app",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

const FEED_SUB = "feed-global";
const OWN_PROFILE_SUB = "own-profile";
const FEED_LIMIT = 50;
/** Overlap window on fresh-`since` resubscribes — clock skew tolerance. */
const RESUME_OVERLAP_SEC = 60;
const SEEN_CAP = 5000;
const PROFILE_BATCH_TIMEOUT_MS = 8000;
const PUBLISH_TIMEOUT_MS = 10_000;
const FEED_SNAPSHOT_KEY = "feed.global";

export interface NostrEngineDeps {
  adapters: PlatformAdapters;
  dispatch: AppDispatch;
  getState: () => RootState;
  relays?: string[];
}

export interface NostrEngine {
  /** Hydrate from SQLite, connect, open the feed sub (once). */
  start(pubkey: string | null): Promise<void>;
  /** Login/logout/account-switch: swap the account DB + own-profile sub. */
  setIdentity(pubkey: string | null): Promise<void>;
  /** Fetch kind-0s for authors missing from the store (batched, one-shot). */
  requestProfiles(pubkeys: string[]): void;
  /** One-shot query: REQ → collect verified events → resolve shortly after
   *  the first EOSE (or on timeout). Profile notes, threads, lookups. */
  fetchEvents(filters: NostrFilter[], timeoutMs?: number): Promise<NostrEvent[]>;
  /** Sign + publish a kind-1; optimistic locally. Resolves true when a
   *  relay OKs it, false on timeout (still kept locally). */
  publishNote(content: string): Promise<boolean>;
  /** Pull-to-refresh: re-REQ the feed; resolves on EOSE (or timeout). */
  refreshFeed(): Promise<void>;
  /** The active signer (null when logged out/guest) — for NIP-98/zap flows
   *  that sign outside the engine's own publish paths. */
  getSigner(): SignerAdapter | null;
  /** The platform adapters — for per-screen sessions (space chat) and the
   *  wallet client, which own their own on-demand sockets. */
  getAdapters(): PlatformAdapters;
  /** NIP-17: wrap + publish a DM (optimistic; resolves when handed off). */
  sendDM(recipient: string, content: string): Promise<void>;
  /** Block flow: drop a DM conversation from Redux + SQLite. */
  removeDMConversation(peerPubkey: string): Promise<void>;
  handleForeground(): void;
  handleBackground(): void;
  handleOnline(): void;
  destroy(): void;
}

export function createNostrEngine(deps: NostrEngineDeps): NostrEngine {
  const { adapters, dispatch, getState } = deps;
  const relays = deps.relays ?? DEFAULT_RELAYS;

  const seen = new Set<string>();
  const feedBuffer: NostrEvent[] = [];
  let feedFlushTimer: ReturnType<typeof setTimeout> | null = null;

  let started = false;
  let ownPubkey: string | null = null;

  const profileBatches = new Map<string, ReturnType<typeof setTimeout>>();
  const profilesInFlight = new Set<string>();
  let profileBatchSeq = 0;

  interface Collector {
    events: NostrEvent[];
    done: () => void;
    timer: ReturnType<typeof setTimeout>;
    graceTimer: ReturnType<typeof setTimeout> | null;
  }
  const collectors = new Map<string, Collector>();
  let fetchSeq = 0;
  /** After the first EOSE, keep collecting briefly for slower relays. */
  const FETCH_EOSE_GRACE_MS = 350;

  const publishWaiters = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  let eoseWaiters: Array<() => void> = [];

  const eventsStore = (): KVStore<NostrEvent> => adapters.storage.getStore("events");
  const profilesStore = (): KVStore<ProfileMetadata & { pubkey: string }> =>
    adapters.storage.getStore("profiles");
  const userStateStore = (): KVStore<string[]> => adapters.storage.getStore("user_state");

  function markSeen(id: string): boolean {
    if (seen.has(id)) return false;
    if (seen.size >= SEEN_CAP) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(id);
    return true;
  }

  function flushFeedBuffer(): void {
    feedFlushTimer = null;
    if (feedBuffer.length === 0) return;
    const batch = feedBuffer.splice(0, feedBuffer.length);
    dispatch(feedEventsReceived(batch));
    // Write-through — cheap (events arrive in trickles at feed volumes).
    for (const event of batch) {
      eventsStore().put(event.id, event).catch(() => {});
    }
  }

  function queueFeedEvent(event: NostrEvent): void {
    feedBuffer.push(event);
    if (!feedFlushTimer) {
      feedFlushTimer = setTimeout(flushFeedBuffer, 50);
    }
  }

  async function routeEvent(subId: string, event: NostrEvent): Promise<void> {
    const collector = collectors.get(subId);
    const firstTime = markSeen(event.id);
    // Global surfaces route each id once; collectors still need their copy
    // (a thread root may already have flowed through the feed).
    if (!firstTime && !collector) return;

    let valid = false;
    try {
      valid = await adapters.verifier.verify(event);
    } catch {
      valid = false;
    }
    if (!valid) return; // fail closed

    // Gift wraps route to the DM engine only — never into feed/collector
    // surfaces (their content is ciphertext until unwrapped).
    if (event.kind === KIND_GIFT_WRAP) {
      if (firstTime) dm.handleWrapEvent(event);
      return;
    }

    // kind-9735 zap receipts fold into the aggregate slice (never stored as
    // full events — desktop pattern) but still reach collectors so a
    // NoteThread one-shot fetch can pull them.
    if (event.kind === 9735 && firstTime) {
      const targetId = event.tags.find((t) => t[0] === "e")?.[1];
      const bolt11 = event.tags.find((t) => t[0] === "bolt11")?.[1];
      if (targetId && bolt11) {
        try {
          const sats = getSatoshisAmountFromBolt11(bolt11);
          if (sats > 0) {
            dispatch(
              zapReceiptSeen({ receiptId: event.id, targetEventId: targetId, msat: sats * 1000 }),
            );
          }
        } catch {
          // malformed bolt11 — ignore
        }
      }
    }

    if (collector && !collector.events.some((e) => e.id === event.id)) {
      collector.events.push(event);
    }
    if (!firstTime) return;

    if (event.kind === 0) {
      const profile = parseProfile(event);
      if (!profile) return;
      profilesInFlight.delete(event.pubkey);
      dispatch(profileReceived({ pubkey: event.pubkey, profile }));
      // Persist whatever the slice decided is newest.
      const newest = getState().profiles.byPubkey[event.pubkey];
      if (newest) {
        profilesStore().put(event.pubkey, { ...newest, pubkey: event.pubkey }).catch(() => {});
      }
      return;
    }

    if (event.kind === 1 && subId === FEED_SUB) {
      queueFeedEvent(event);
    }
  }

  function handleEose(subId: string): void {
    if (dm.handleEose(subId)) return;
    if (subId === FEED_SUB) {
      flushFeedBuffer();
      dispatch(feedStatusChanged("live"));
      persistFeedSnapshot().catch(() => {});
      const waiters = eoseWaiters;
      eoseWaiters = [];
      for (const resolve of waiters) resolve();
      return;
    }
    const timer = profileBatches.get(subId);
    if (timer) {
      clearTimeout(timer);
      profileBatches.delete(subId);
      pool.unsubscribe(subId);
      return;
    }
    const collector = collectors.get(subId);
    if (collector && !collector.graceTimer) {
      collector.graceTimer = setTimeout(collector.done, FETCH_EOSE_GRACE_MS);
    }
  }

  const pool: RelayPool = createRelayPool(adapters.ws, {
    onEvent: (subId, event) => {
      routeEvent(subId, event).catch(() => {});
    },
    onEose: (subId) => handleEose(subId),
    onStatus: (url, status) => {
      dispatch(setRelayStatus({ url, status }));
    },
    onOk: (eventId, accepted) => {
      dm.handleOk(eventId, accepted);
      const waiter = publishWaiters.get(eventId);
      if (waiter && accepted) {
        clearTimeout(waiter.timer);
        publishWaiters.delete(eventId);
        waiter.resolve(true);
      }
    },
  });

  function fetchEventsImpl(filters: NostrFilter[], timeoutMs = 8000): Promise<NostrEvent[]> {
    const subId = `fetch-${fetchSeq++}`;
    return new Promise<NostrEvent[]>((resolve) => {
      const done = () => {
        const collector = collectors.get(subId);
        if (!collector) return;
        collectors.delete(subId);
        clearTimeout(collector.timer);
        if (collector.graceTimer) clearTimeout(collector.graceTimer);
        pool.unsubscribe(subId);
        resolve(collector.events);
      };
      collectors.set(subId, {
        events: [],
        done,
        timer: setTimeout(done, timeoutMs),
        graceTimer: null,
      });
      pool.subscribe(subId, filters);
    });
  }

  const dm: DmEngine = createDmEngine({
    adapters,
    dispatch,
    getState,
    pool,
    relays,
    fetchEvents: fetchEventsImpl,
  });

  function subscribeFeed(since?: number): void {
    const filter: NostrFilter = { kinds: [1], limit: FEED_LIMIT };
    if (since && since > 0) filter.since = since;
    pool.subscribe(FEED_SUB, [filter]);
  }

  function subscribeOwnProfile(): void {
    if (!ownPubkey) return;
    pool.subscribe(OWN_PROFILE_SUB, [{ kinds: [0], authors: [ownPubkey], limit: 1 }]);
  }

  async function hydrateFromStorage(): Promise<void> {
    try {
      const [snapshotIds, events, profiles] = await Promise.all([
        userStateStore().get(FEED_SNAPSHOT_KEY),
        eventsStore().getAll(),
        profilesStore().getAll(),
      ]);

      if (profiles.length > 0) {
        const byPubkey: Record<string, ProfileMetadata> = {};
        for (const entry of profiles) {
          const { pubkey, ...profile } = entry;
          if (pubkey) byPubkey[pubkey] = profile;
        }
        dispatch(profilesHydrated(byPubkey));
      }

      if (events.length > 0) {
        const wanted = snapshotIds ? new Set(snapshotIds) : null;
        const feedEvents = events.filter(
          (event) => event.kind === 1 && (!wanted || wanted.has(event.id)),
        );
        for (const event of feedEvents) markSeen(event.id);
        if (feedEvents.length > 0) dispatch(feedHydrated(feedEvents));
      }
    } catch {
      // Cold start with no/corrupt cache — the live sub will fill the feed.
    }
  }

  async function persistFeedSnapshot(): Promise<void> {
    const { ids } = getState().feed;
    if (ids.length === 0) return;
    try {
      await userStateStore().put(FEED_SNAPSHOT_KEY, [...ids]);
      // Prune events that fell off the feed so the cache stays bounded.
      const keep = new Set(ids);
      const keys = await eventsStore().getAllKeys();
      for (const key of keys) {
        if (!keep.has(key)) await eventsStore().delete(key);
      }
    } catch {
      // persistence is best-effort
    }
  }

  return {
    async start(pubkey: string | null): Promise<void> {
      if (started) return;
      started = true;
      ownPubkey = pubkey;
      if (pubkey) {
        await adapters.storage.openForAccount(pubkey).catch(() => {});
      }
      dispatch(feedStatusChanged("loading"));
      await hydrateFromStorage();

      pool.connect(relays);
      const { lastSeenAt } = getState().feed;
      subscribeFeed(lastSeenAt > 0 ? lastSeenAt - RESUME_OVERLAP_SEC : undefined);
      subscribeOwnProfile();
      if (pubkey && adapters.signer) {
        await dm.start(pubkey).catch(() => {});
      }
    },

    async setIdentity(pubkey: string | null): Promise<void> {
      if (pubkey === ownPubkey) return;
      dm.stop();
      ownPubkey = pubkey;
      if (pubkey) {
        await adapters.storage.openForAccount(pubkey).catch(() => {});
        subscribeOwnProfile();
        if (adapters.signer) {
          await dm.start(pubkey).catch(() => {});
        }
      } else {
        pool.unsubscribe(OWN_PROFILE_SUB);
        // Back to the app-global DB (lazy reopen on next access).
        await adapters.storage.close().catch(() => {});
      }
    },

    fetchEvents: fetchEventsImpl,

    requestProfiles(pubkeys: string[]): void {
      const known = getState().profiles.byPubkey;
      const missing = [
        ...new Set(
          pubkeys.filter((pk) => !known[pk] && !profilesInFlight.has(pk)),
        ),
      ];
      if (missing.length === 0) return;
      for (const pk of missing) profilesInFlight.add(pk);

      const subId = `profiles-${profileBatchSeq++}`;
      pool.subscribe(subId, [{ kinds: [0], authors: missing, limit: missing.length }]);
      const timer = setTimeout(() => {
        profileBatches.delete(subId);
        pool.unsubscribe(subId);
        for (const pk of missing) profilesInFlight.delete(pk);
      }, PROFILE_BATCH_TIMEOUT_MS);
      profileBatches.set(subId, timer);
    },

    async publishNote(content: string): Promise<boolean> {
      const signer = adapters.signer;
      if (!signer) throw new Error("Sign in to post.");
      const trimmed = content.trim();
      if (!trimmed) throw new Error("Write something first.");

      const unsigned: UnsignedEvent = {
        pubkey: await signer.getPublicKey(),
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: trimmed,
      };
      const signed = await signer.signEvent(unsigned);

      // Optimistic: it's our own valid event — straight into the feed + cache.
      markSeen(signed.id);
      dispatch(feedEventsReceived([signed]));
      eventsStore().put(signed.id, signed).catch(() => {});
      persistFeedSnapshot().catch(() => {});

      pool.publish(signed);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          publishWaiters.delete(signed.id);
          resolve(false); // unconfirmed — kept locally, relays may still take it
        }, PUBLISH_TIMEOUT_MS);
        publishWaiters.set(signed.id, { resolve, timer });
      });
    },

    refreshFeed(): Promise<void> {
      dispatch(feedStatusChanged(getState().feed.ids.length ? "live" : "loading"));
      subscribeFeed(); // fresh limit-50 REQ (same sub id → filters replaced)
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          eoseWaiters = eoseWaiters.filter((w) => w !== wrapped);
          resolve();
        }, PROFILE_BATCH_TIMEOUT_MS);
        const wrapped = () => {
          clearTimeout(timer);
          resolve();
        };
        eoseWaiters.push(wrapped);
      });
    },

    getSigner(): SignerAdapter | null {
      return adapters.signer;
    },

    getAdapters(): PlatformAdapters {
      return adapters;
    },

    sendDM(recipient: string, content: string): Promise<void> {
      return dm.sendDM(recipient, content);
    },

    removeDMConversation(peerPubkey: string): Promise<void> {
      return dm.removeConversation(peerPubkey);
    },

    handleForeground(): void {
      if (!started) return;
      pool.resume();
      // iOS killed the sockets while suspended — rebuild the feed REQ with a
      // fresh `since` so suspended-time events backfill (guide 06 §2). The DM
      // sub resubscribes with its own (3-day lookback) watermark.
      const { lastSeenAt } = getState().feed;
      subscribeFeed(lastSeenAt > 0 ? lastSeenAt - RESUME_OVERLAP_SEC : undefined);
      subscribeOwnProfile();
      dm.handleForeground();
    },

    handleBackground(): void {
      if (!started) return;
      flushFeedBuffer();
      persistFeedSnapshot().catch(() => {});
      pool.suspend();
    },

    handleOnline(): void {
      if (!started) return;
      pool.reconnectNow();
    },

    destroy(): void {
      dm.destroy();
      if (feedFlushTimer) clearTimeout(feedFlushTimer);
      for (const timer of profileBatches.values()) clearTimeout(timer);
      profileBatches.clear();
      for (const collector of [...collectors.values()]) collector.done();
      for (const waiter of publishWaiters.values()) clearTimeout(waiter.timer);
      publishWaiters.clear();
      pool.destroy();
    },
  };
}
