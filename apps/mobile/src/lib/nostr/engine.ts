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
import { createSpaceSignal, type SpaceSignal } from "./spaceSignal";
import { normalizeRelayUrl } from "./relayUrl";
import { parseFollowList } from "./follows";
import { parseThreadRef, reactionTargetId, repostTargetId } from "./noteTags";
import { parseProfile, type ProfileMetadata } from "./profiles";
import { AUTHORS_CHUNK } from "./spaceFeedRoutes";
import type { KVStore, PlatformAdapters, SignerAdapter } from "@/core/adapters";
import type { AppDispatch, RootState } from "@/store";
import {
  engagementReceived,
  type EngagementBatch,
} from "@/store/slices/engagementSlice";
import {
  FEED_CONTEXTS,
  feedCleared,
  feedContextSwitched,
  feedEventsReceived,
  feedHydrated,
  feedStatusChanged,
  type FeedContext,
} from "@/store/slices/feedSlice";
import {
  followsCleared,
  followsLoading,
  followsMissing,
  followsReceived,
} from "@/store/slices/followsSlice";
import { profileReceived, profilesHydrated } from "@/store/slices/profilesSlice";
import { reset as resetPlayback } from "@/lib/music/playerService";
import { musicCleared } from "@/store/slices/musicSlice";
import { setRelayStatus } from "@/store/slices/relaysSlice";
import {
  REPLY_PAGE_LIMIT,
  THREAD_EVENTS_CAP,
  threadEventsMerged,
  threadFetchCompleted,
  threadFetchStarted,
  threadOlderCompleted,
  threadOlderStarted,
  threadsCleared,
} from "@/store/slices/threadsSlice";
import { zapReceiptSeen } from "@/store/slices/zapsSlice";
import { ensureSpaceMeta } from "@/store/spaceMeta";

/** 3 sockets max on mobile — battery discipline (guide 06 §3). App relay is
 *  env-resolved (local :7777 in dev, thewired.app in release — lib/env.ts). */
export { DEFAULT_RELAYS } from "@/lib/env";
import { DEFAULT_RELAYS } from "@/lib/env";

const FEED_SUB = "feed-global";
const OWN_PROFILE_SUB = "own-profile";
/** Viewport engagement batches ride ONE fixed sub id — re-subscribing
 *  replaces the filters, closing the previous batch server-side. */
const ENGAGEMENT_SUB = "engagement";
const FEED_LIMIT = 50;
/** Overlap window on fresh-`since` resubscribes — clock skew tolerance. */
const RESUME_OVERLAP_SEC = 60;
const SEEN_CAP = 5000;
const PROFILE_BATCH_TIMEOUT_MS = 8000;
const PUBLISH_TIMEOUT_MS = 10_000;
/** Per-context snapshot keys ("feed.global" predates contexts — no migration). */
const FEED_SNAPSHOT_KEYS: Record<FeedContext, string> = {
  global: "feed.global",
  follows: "feed.follows",
};

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
  /** Fetch a whole conversation by root id into the thread cache — root +
   *  subtree (+ a focus leg for non-compliant repliers) + engagement, one
   *  REQ. Cache-warm screens render immediately; this refreshes (SWR). */
  loadThread(rootId: string, focusId?: string): Promise<void>;
  /** Page older replies below the truncation watermark (`until`). No-ops at
   *  the per-thread cap — merged pages would evict straight back out. */
  loadOlderReplies(rootId: string): Promise<void>;
  /** Sign + publish a kind-1; optimistic locally. Resolves true when a
   *  relay OKs it, false on timeout (still kept locally). */
  publishNote(content: string): Promise<boolean>;
  /** Pull-to-refresh: re-REQ the feed; resolves on EOSE (or timeout). */
  refreshFeed(): Promise<void>;
  /** Swap the FEED_SUB filters to the given context — same sub id on the
   *  existing sockets, never a new connection. */
  setFeedContext(context: FeedContext): void;
  /** Re-fetch the kind-3 (retry affordance on the "missing" empty state). */
  refreshFollows(): Promise<void>;
  /** Engagement REQ for a batch of note ids — one REQ, four OR'd filters
   *  (kinds 7/6/1/9735, each "#e": ids) on a fixed sub id; calling again
   *  replaces the filters (previous batch closes). No new sockets. */
  subscribeEngagement(ids: string[]): void;
  unsubscribeEngagement(): void;
  /** Kind-7 like (NIP-25; desktop buildReaction tag parity). Optimistic into
   *  the engagement aggregates; resolves true on relay OK. */
  publishReaction(target: NostrEvent, content?: string): Promise<boolean>;
  /** Kind-6 repost (NIP-18; desktop buildRepost parity — no relay hint). */
  publishRepost(target: NostrEvent): Promise<boolean>;
  /** Kind-1 NIP-10 marked reply. `rootId` is the thread root when the target
   *  is itself a reply; omitted, the target is the root. */
  publishReply(
    content: string,
    target: { eventId: string; pubkey: string; rootId?: string },
  ): Promise<boolean>;
  /** Feed the space-signal sub the joined-space set (SpacesHome focus
   *  effect). One relay-targeted sub on the app relay updates previews +
   *  unread for every joined app-relay space; identical sets no-op. */
  setSignalSpaces(spaces: Array<{ spaceId: string; hostRelay: string | null }>): void;
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

  // Per-context feed dedup: the global `seen` set would silently drop relay
  // re-sends after a filter swap (an event seen under global gets re-sent for
  // the follows REQ → hole in the follows feed). Bounded like `seen`.
  let feedContext: FeedContext = "global";
  const feedSeen: Record<FeedContext, Set<string>> = {
    global: new Set(),
    follows: new Set(),
  };

  function markFeedSeen(context: FeedContext, id: string): void {
    const set = feedSeen[context];
    if (set.size >= SEEN_CAP) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
    set.add(id);
  }

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

  /** Resolve true on relay OK, false on timeout (event kept locally). */
  function awaitOk(eventId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        publishWaiters.delete(eventId);
        resolve(false);
      }, PUBLISH_TIMEOUT_MS);
      publishWaiters.set(eventId, { resolve, timer });
    });
  }

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
    let batch = feedBuffer.splice(0, feedBuffer.length);
    if (feedContext === "follows") {
      // Late global stragglers can land in the buffer right after a filter
      // swap — the follows bucket only ever takes followed authors.
      const followSet = new Set(getState().follows.pubkeys);
      batch = batch.filter((event) => followSet.has(event.pubkey));
      if (batch.length === 0) return;
    }
    dispatch(feedEventsReceived({ context: feedContext, events: batch }));
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

  // Engagement events batch like the feed (never a dispatch per kind-7) but
  // skip SQLite write-through — aggregates are cheap to refetch per mount.
  let engagementBuffer: EngagementBatch = { reactions: [], reposts: [], replies: [] };
  let engagementFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushEngagementBuffer(): void {
    engagementFlushTimer = null;
    const batch = engagementBuffer;
    if (!batch.reactions.length && !batch.reposts.length && !batch.replies.length) return;
    engagementBuffer = { reactions: [], reposts: [], replies: [] };
    dispatch(engagementReceived(batch));
  }

  function queueEngagement(fill: (batch: EngagementBatch) => void): void {
    fill(engagementBuffer);
    if (!engagementFlushTimer) {
      engagementFlushTimer = setTimeout(flushEngagementBuffer, 50);
    }
  }

  // Live thread arrivals batch the same way — replies streaming in (via the
  // engagement sub's kind-1 leg, the feed, or a fetch) land in the thread
  // cache for conversations that already have an entry. The existence guard
  // means stray feed traffic never creates entries; open/cached threads
  // update live while you read.
  const threadBuffer = new Map<string, NostrEvent[]>();
  let threadFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushThreadBuffer(): void {
    threadFlushTimer = null;
    if (threadBuffer.size === 0) return;
    const batches = [...threadBuffer.entries()];
    threadBuffer.clear();
    for (const [rootId, events] of batches) {
      dispatch(threadEventsMerged({ rootId, events }));
    }
  }

  function queueThreadEvent(rootId: string, event: NostrEvent): void {
    const pending = threadBuffer.get(rootId);
    if (pending) pending.push(event);
    else threadBuffer.set(rootId, [event]);
    if (!threadFlushTimer) {
      threadFlushTimer = setTimeout(flushThreadBuffer, 50);
    }
  }

  async function routeEvent(subId: string, event: NostrEvent, relayUrl: string): Promise<void> {
    // Space-signal kind-9s route to their own module only — never into the
    // feed/collector surfaces (verification happens inside handleEvent).
    if (spaceSignal.ownsSub(subId)) {
      spaceSignal.handleEvent(event, relayUrl);
      return;
    }
    const collector = collectors.get(subId);
    const firstTime = markSeen(event.id);
    // A relay re-send after a context filter swap is new to the *other*
    // context's feed even though `seen` already has it.
    const feedCandidate =
      event.kind === 1 && subId === FEED_SUB && !feedSeen[feedContext].has(event.id);
    // Global surfaces route each id once; collectors still need their copy
    // (a thread root may already have flowed through the feed).
    if (!firstTime && !collector && !feedCandidate) return;

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

    // Reactions/reposts fold into the engagement aggregates (shape-based, not
    // sub-based — thread one-shot fetches populate counts too), placed before
    // the collector push so fetchEvents still sees the raw events.
    if (event.kind === 7 && firstTime) {
      const targetId = reactionTargetId(event); // last e-tag (NIP-25)
      if (targetId) {
        queueEngagement((batch) =>
          batch.reactions.push({
            targetEventId: targetId,
            reactor: event.pubkey,
            content: event.content,
            eventId: event.id,
          }),
        );
      }
    }
    if (event.kind === 6 && firstTime) {
      const targetId = repostTargetId(event); // first e-tag
      if (targetId) {
        queueEngagement((batch) =>
          batch.reposts.push({
            targetEventId: targetId,
            reposter: event.pubkey,
            eventId: event.id,
          }),
        );
      }
    }
    // Any first-time kind-1 that references a parent counts as a reply —
    // whether it arrived on the feed, the engagement sub, or a fetch.
    if (event.kind === 1 && firstTime) {
      const ref = parseThreadRef(event);
      if (ref.rootId) {
        queueEngagement((batch) => {
          batch.replies.push({ targetEventId: ref.rootId!, eventId: event.id });
          if (ref.replyId && ref.replyId !== ref.rootId) {
            batch.replies.push({ targetEventId: ref.replyId!, eventId: event.id });
          }
        });
        if (getState().threads.byRoot[ref.rootId]) {
          queueThreadEvent(ref.rootId, event);
        }
      }
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

    if (feedCandidate) {
      markFeedSeen(feedContext, event.id);
      queueFeedEvent(event);
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
  }

  function handleEose(subId: string): void {
    if (dm.handleEose(subId)) return;
    if (subId === FEED_SUB) {
      flushFeedBuffer();
      dispatch(feedStatusChanged({ context: feedContext, status: "live" }));
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
    onEvent: (subId, event, relayUrl) => {
      routeEvent(subId, event, relayUrl).catch(() => {});
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
    onAuth: (challenge, relayUrl) => {
      answerAuthChallenge(challenge, relayUrl).catch(() => {});
    },
  });

  /** NIP-42 for the shared pool. Only the app relay's challenges are
   *  answered — public relays also send AUTH, and binding our key to them
   *  buys nothing for the subs we run there. The kind-22242 OK frame falls
   *  through onOk harmlessly (no publish waiter). */
  const appRelayUrl = relays[0];
  async function answerAuthChallenge(challenge: string, relayUrl: string): Promise<void> {
    if (normalizeRelayUrl(relayUrl) !== normalizeRelayUrl(appRelayUrl)) return;
    const signer = adapters.signer;
    if (!signer) return;
    const signed = await signer.signEvent({
      pubkey: await signer.getPublicKey(),
      created_at: Math.floor(Date.now() / 1000),
      kind: 22242,
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    });
    pool.auth(signed, relayUrl);
    // The signal sub is the only auth-gated REQ on this pool — re-REQ it so
    // it runs under the authenticated read set (public-kind subs already
    // answered fine pre-auth).
    spaceSignal.handleAuthed();
  }

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

  const spaceSignal: SpaceSignal = createSpaceSignal({
    adapters,
    dispatch,
    getState,
    pool,
    appRelayUrl,
    // The space-meta cache is the directory source. Reject when channels
    // are unavailable (fetch failed / still owned by another caller) so the
    // signal drops its untagged buffer and retries, instead of caching a
    // bogus "chat"-only directory built from [].
    fetchChannelDirectory: (spaceId) =>
      dispatch(ensureSpaceMeta(spaceId)).then((entry) => {
        if (!entry || entry.channels === null) {
          throw new Error("channel directory unavailable");
        }
        return entry.channels;
      }),
  });

  function requestProfilesImpl(pubkeys: string[]): void {
    const known = getState().profiles.byPubkey;
    const missing = [
      ...new Set(pubkeys.filter((pk) => !known[pk] && !profilesInFlight.has(pk))),
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
  }

  async function loadThreadImpl(rootId: string, focusId?: string): Promise<void> {
    dispatch(threadFetchStarted({ rootId }));

    const engagementIds = [rootId];
    const filters: NostrFilter[] = [
      { ids: [rootId] },
      { kinds: [1], "#e": [rootId], limit: REPLY_PAGE_LIMIT },
    ];
    if (focusId && focusId !== rootId) {
      // The focus event itself (the subtree leg may truncate past it) plus
      // replies from non-compliant clients that tag only their parent.
      filters.push({ ids: [focusId] });
      filters.push({ kinds: [1], "#e": [focusId], limit: REPLY_PAGE_LIMIT });
      engagementIds.push(focusId);
    }
    // Reactions/reposts/zaps fold into the aggregate slices via routeEvent
    // (shape-based) — nothing to merge here.
    filters.push({ kinds: [7, 6, 9735], "#e": engagementIds, limit: 100 });

    const events = await fetchEventsImpl(filters);
    const notes = events.filter((event) => event.kind === 1);
    if (notes.length > 0) dispatch(threadEventsMerged({ rootId, events: notes }));

    // Truncation honesty: fetchEvents merges filters, so count post-hoc. A
    // multi-relay merge can exceed the per-relay limit — hence >=.
    const repliesTaggingRoot = notes.filter(
      (event) =>
        event.id !== rootId && event.tags.some((t) => t[0] === "e" && t[1] === rootId),
    );
    dispatch(
      threadFetchCompleted({
        rootId,
        fetchedAt: Math.floor(Date.now() / 1000),
        truncated: repliesTaggingRoot.length >= REPLY_PAGE_LIMIT,
        oldestReplyAt: repliesTaggingRoot.length
          ? Math.min(...repliesTaggingRoot.map((event) => event.created_at))
          : null,
      }),
    );

    const authors = new Set(notes.map((event) => event.pubkey));
    if (authors.size > 0) requestProfilesImpl([...authors]);
  }

  async function loadOlderRepliesImpl(rootId: string): Promise<void> {
    const entry = getState().threads.byRoot[rootId];
    if (!entry || entry.loadingOlder || entry.oldestReplyAt === null) return;
    // At the cap the oldest events evict on merge — paging would fetch
    // straight into the void. The screen shows the cap notice instead.
    if (entry.events.length >= THREAD_EVENTS_CAP) return;

    dispatch(threadOlderStarted({ rootId }));
    const events = await fetchEventsImpl([
      {
        kinds: [1],
        "#e": [rootId],
        until: entry.oldestReplyAt - 1,
        limit: REPLY_PAGE_LIMIT,
      },
    ]);
    const notes = events.filter((event) => event.kind === 1);
    if (notes.length > 0) dispatch(threadEventsMerged({ rootId, events: notes }));
    dispatch(
      threadOlderCompleted({
        rootId,
        oldestReplyAt: notes.length
          ? Math.min(entry.oldestReplyAt, ...notes.map((event) => event.created_at))
          : entry.oldestReplyAt,
        exhausted: notes.length < REPLY_PAGE_LIMIT,
      }),
    );
    const authors = new Set(notes.map((event) => event.pubkey));
    if (authors.size > 0) requestProfilesImpl([...authors]);
  }

  function buildFeedFilters(context: FeedContext, since?: number): NostrFilter[] {
    if (context === "global") {
      const filter: NostrFilter = { kinds: [1], limit: FEED_LIMIT };
      if (since && since > 0) filter.since = since;
      return [filter];
    }
    // Follows: never degenerate into a bare {kinds:[1]} — an empty author
    // list means "nothing to subscribe to", not "everything".
    const authors = getState().follows.pubkeys;
    const filters: NostrFilter[] = [];
    for (let i = 0; i < authors.length; i += AUTHORS_CHUNK) {
      const filter: NostrFilter = {
        kinds: [1],
        authors: authors.slice(i, i + AUTHORS_CHUNK),
        limit: FEED_LIMIT,
      };
      if (since && since > 0) filter.since = since;
      filters.push(filter);
    }
    return filters;
  }

  function subscribeFeed(since?: number): void {
    const filters = buildFeedFilters(feedContext, since);
    if (filters.length === 0) {
      // Nothing to REQ (follows context with 0 authors) — close the sub and
      // settle the status so the UI shows an empty state, not a spinner.
      pool.unsubscribe(FEED_SUB);
      dispatch(feedStatusChanged({ context: feedContext, status: "live" }));
      const waiters = eoseWaiters;
      eoseWaiters = [];
      for (const resolve of waiters) resolve();
      return;
    }
    pool.subscribe(FEED_SUB, filters);
  }

  /** Instant content on switch: followed-author events already cached in the
   *  global bucket seed the follows bucket before the REQ answers. */
  function crossSeedFollows(): void {
    const follows = new Set(getState().follows.pubkeys);
    if (follows.size === 0) return;
    const entities = getState().feed.byContext.global.entities;
    const seedEvents = Object.values(entities).filter((event) => follows.has(event.pubkey));
    if (seedEvents.length === 0) return;
    for (const event of seedEvents) markFeedSeen("follows", event.id);
    dispatch(feedEventsReceived({ context: "follows", events: seedEvents }));
  }

  function setFeedContextImpl(context: FeedContext): void {
    if (context === feedContext) return;
    flushFeedBuffer(); // drain the old context's buffer before the flip
    feedContext = context;
    dispatch(feedContextSwitched(context));
    if (context === "follows") crossSeedFollows();
    const ctx = getState().feed.byContext[context];
    dispatch(
      feedStatusChanged({ context, status: ctx.ids.length ? "live" : "loading" }),
    );
    subscribeFeed(ctx.lastSeenAt > 0 ? ctx.lastSeenAt - RESUME_OVERLAP_SEC : undefined);
  }

  /** Logout / account switch: follows state must never leak across identities. */
  function clearFollowsState(): void {
    dispatch(followsCleared());
    dispatch(feedCleared({ context: "follows" }));
    feedSeen.follows.clear();
  }

  /** Fetch + parse the kind-3 for `pubkey` (read-only — no publish path),
   *  then re-REQ the feed if the follows context is active. */
  async function syncFollows(pubkey: string | null): Promise<void> {
    if (!pubkey) {
      if (feedContext === "follows") subscribeFeed();
      return;
    }
    dispatch(followsLoading());
    const events = await fetchEventsImpl([{ kinds: [3], authors: [pubkey], limit: 3 }]);
    const parsed = parseFollowList(events);
    const fetchedAt = Math.floor(Date.now() / 1000);
    if (parsed) {
      dispatch(followsReceived({ ...parsed, fetchedAt }));
    } else {
      dispatch(followsMissing({ fetchedAt }));
    }
    if (feedContext === "follows") {
      const ctx = getState().feed.byContext.follows;
      dispatch(
        feedStatusChanged({
          context: "follows",
          status: ctx.ids.length ? "live" : "loading",
        }),
      );
      subscribeFeed(ctx.lastSeenAt > 0 ? ctx.lastSeenAt - RESUME_OVERLAP_SEC : undefined);
    }
  }

  function subscribeOwnProfile(): void {
    if (!ownPubkey) return;
    pool.subscribe(OWN_PROFILE_SUB, [{ kinds: [0], authors: [ownPubkey], limit: 1 }]);
  }

  async function hydrateFromStorage(): Promise<void> {
    try {
      const [globalSnapshot, followsSnapshot, events, profiles] = await Promise.all([
        userStateStore().get(FEED_SNAPSHOT_KEYS.global),
        userStateStore().get(FEED_SNAPSHOT_KEYS.follows),
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
        const byId = new Map(
          events.filter((event) => event.kind === 1).map((event) => [event.id, event]),
        );
        const hydrate = (context: FeedContext, ids: string[] | null | undefined) => {
          // Global with no snapshot takes every cached kind-1 (legacy caches);
          // follows only ever hydrates from its own snapshot.
          const feedEvents = ids
            ? ids.map((id) => byId.get(id)).filter((e): e is NostrEvent => !!e)
            : context === "global"
              ? [...byId.values()]
              : [];
          if (feedEvents.length === 0) return;
          for (const event of feedEvents) {
            markSeen(event.id);
            markFeedSeen(context, event.id);
          }
          dispatch(feedHydrated({ context, events: feedEvents }));
        };
        hydrate("global", globalSnapshot);
        hydrate("follows", followsSnapshot);
      }
    } catch {
      // Cold start with no/corrupt cache — the live sub will fill the feed.
    }
  }

  async function persistFeedSnapshot(): Promise<void> {
    const { byContext } = getState().feed;
    // Two contexts share one events store — prune against the UNION so one
    // context's snapshot never deletes the other's rows.
    const keep = new Set<string>();
    try {
      for (const context of FEED_CONTEXTS) {
        const ids = byContext[context].ids;
        for (const id of ids) keep.add(id);
        if (ids.length > 0) {
          await userStateStore().put(FEED_SNAPSHOT_KEYS[context], [...ids]);
        }
      }
      if (keep.size === 0) return;
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
      dispatch(feedStatusChanged({ context: feedContext, status: "loading" }));
      await hydrateFromStorage();

      pool.connect(relays);
      const { lastSeenAt } = getState().feed.byContext[feedContext];
      subscribeFeed(lastSeenAt > 0 ? lastSeenAt - RESUME_OVERLAP_SEC : undefined);
      subscribeOwnProfile();
      if (pubkey) syncFollows(pubkey).catch(() => {});
      if (pubkey && adapters.signer) {
        await dm.start(pubkey).catch(() => {});
      }
    },

    async setIdentity(pubkey: string | null): Promise<void> {
      if (pubkey === ownPubkey) return;
      dm.stop();
      // The signal set belongs to the old identity's joined spaces — close it;
      // SpacesHome's focus effect re-feeds the new identity's set.
      spaceSignal.stop();
      ownPubkey = pubkey;
      // Follows must never leak across identities — clear before the new
      // account's sync (or the logged-out resub) runs. The thread cache
      // holds public events but drops too — optimistic inserts and LRU
      // state shouldn't straddle identities.
      clearFollowsState();
      dispatch(threadsCleared());
      // Music catalog + player mirror belong to the old identity — reset the
      // Redux mirror and stop native playback (no-op if never set up).
      dispatch(musicCleared());
      void resetPlayback();
      if (pubkey) {
        await adapters.storage.openForAccount(pubkey).catch(() => {});
        subscribeOwnProfile();
        syncFollows(pubkey).catch(() => {});
        if (adapters.signer) {
          await dm.start(pubkey).catch(() => {});
        }
      } else {
        pool.unsubscribe(OWN_PROFILE_SUB);
        syncFollows(null).catch(() => {});
        // Back to the app-global DB (lazy reopen on next access).
        await adapters.storage.close().catch(() => {});
      }
    },

    fetchEvents: fetchEventsImpl,

    requestProfiles: requestProfilesImpl,

    loadThread: loadThreadImpl,

    loadOlderReplies: loadOlderRepliesImpl,

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
      // Both contexts: your own note is semantically always "followed" and
      // must appear wherever you're looking.
      markSeen(signed.id);
      markFeedSeen("global", signed.id);
      markFeedSeen("follows", signed.id);
      dispatch(feedEventsReceived({ context: "global", events: [signed] }));
      dispatch(feedEventsReceived({ context: "follows", events: [signed] }));
      eventsStore().put(signed.id, signed).catch(() => {});
      persistFeedSnapshot().catch(() => {});

      pool.publish(signed);
      return awaitOk(signed.id);
    },

    async publishReaction(target: NostrEvent, content = "+"): Promise<boolean> {
      const signer = adapters.signer;
      if (!signer) throw new Error("Sign in to react.");
      const unsigned: UnsignedEvent = {
        pubkey: await signer.getPublicKey(),
        created_at: Math.floor(Date.now() / 1000),
        kind: 7,
        // Desktop buildReaction parity: e + p + k (target's kind).
        tags: [
          ["e", target.id],
          ["p", target.pubkey],
          ["k", String(target.kind)],
        ],
        content,
      };
      const signed = await signer.signEvent(unsigned);
      markSeen(signed.id); // relay echo dedups
      // Direct dispatch, not the buffer — the tap must reflect instantly.
      dispatch(
        engagementReceived({
          reactions: [
            {
              targetEventId: target.id,
              reactor: signed.pubkey,
              content,
              eventId: signed.id,
            },
          ],
          reposts: [],
          replies: [],
        }),
      );
      pool.publish(signed);
      return awaitOk(signed.id);
    },

    async publishRepost(target: NostrEvent): Promise<boolean> {
      const signer = adapters.signer;
      if (!signer) throw new Error("Sign in to repost.");
      const unsigned: UnsignedEvent = {
        pubkey: await signer.getPublicKey(),
        created_at: Math.floor(Date.now() / 1000),
        kind: 6,
        // Desktop buildRepost parity: embedded original, e + p, no relay hint.
        tags: [
          ["e", target.id],
          ["p", target.pubkey],
        ],
        content: JSON.stringify(target),
      };
      const signed = await signer.signEvent(unsigned);
      markSeen(signed.id);
      dispatch(
        engagementReceived({
          reactions: [],
          reposts: [
            { targetEventId: target.id, reposter: signed.pubkey, eventId: signed.id },
          ],
          replies: [],
        }),
      );
      pool.publish(signed);
      return awaitOk(signed.id);
    },

    async publishReply(
      content: string,
      target: { eventId: string; pubkey: string; rootId?: string },
    ): Promise<boolean> {
      const signer = adapters.signer;
      if (!signer) throw new Error("Sign in to reply.");
      const trimmed = content.trim();
      if (!trimmed) throw new Error("Write something first.");

      // NIP-10 marked tags (desktop buildReply parity): the thread root is
      // the target itself unless the target is already a reply.
      const rootId = target.rootId ?? target.eventId;
      const tags: string[][] = [["e", rootId, "", "root"]];
      if (target.eventId !== rootId) tags.push(["e", target.eventId, "", "reply"]);
      tags.push(["p", target.pubkey]);

      const unsigned: UnsignedEvent = {
        pubkey: await signer.getPublicKey(),
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags,
        content: trimmed,
      };
      const signed = await signer.signEvent(unsigned);

      // Optimistic: reply counts + the feed (it's a kind-1 like any other).
      markSeen(signed.id);
      markFeedSeen("global", signed.id);
      markFeedSeen("follows", signed.id);
      const replies = [{ targetEventId: rootId, eventId: signed.id }];
      if (target.eventId !== rootId) {
        replies.push({ targetEventId: target.eventId, eventId: signed.id });
      }
      dispatch(engagementReceived({ reactions: [], reposts: [], replies }));
      dispatch(feedEventsReceived({ context: "global", events: [signed] }));
      dispatch(feedEventsReceived({ context: "follows", events: [signed] }));
      // Thread cache too — the thread screen renders the reply on return
      // from the composer without a refetch.
      dispatch(threadEventsMerged({ rootId, events: [signed] }));
      eventsStore().put(signed.id, signed).catch(() => {});

      pool.publish(signed);
      return awaitOk(signed.id);
    },

    subscribeEngagement(ids: string[]): void {
      if (ids.length === 0) return;
      // No `limit`: viewport chunking is the volume control (desktop parity).
      pool.subscribe(ENGAGEMENT_SUB, [
        { kinds: [7], "#e": ids },
        { kinds: [6], "#e": ids },
        { kinds: [1], "#e": ids },
        { kinds: [9735], "#e": ids },
      ]);
    },

    unsubscribeEngagement(): void {
      pool.unsubscribe(ENGAGEMENT_SUB);
    },

    refreshFeed(): Promise<void> {
      dispatch(
        feedStatusChanged({
          context: feedContext,
          status: getState().feed.byContext[feedContext].ids.length ? "live" : "loading",
        }),
      );
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

    setFeedContext(context: FeedContext): void {
      setFeedContextImpl(context);
    },

    setSignalSpaces(spaces): void {
      spaceSignal.setSpaces(spaces);
    },

    async refreshFollows(): Promise<void> {
      await syncFollows(ownPubkey);
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
      // sub resubscribes with its own (3-day lookback) watermark. The inactive
      // context catches up on its next switch via its own lastSeenAt.
      const { lastSeenAt } = getState().feed.byContext[feedContext];
      subscribeFeed(lastSeenAt > 0 ? lastSeenAt - RESUME_OVERLAP_SEC : undefined);
      subscribeOwnProfile();
      // Fresh-`since` re-REQ — the onopen registry replay ran pre-AUTH and
      // got nothing for the auth-gated signal sub; this re-REQs post-resume
      // (and the relay's fresh AUTH challenge re-REQs again once answered).
      spaceSignal.resubscribe();
      dm.handleForeground();
    },

    handleBackground(): void {
      if (!started) return;
      flushFeedBuffer();
      flushEngagementBuffer();
      flushThreadBuffer();
      persistFeedSnapshot().catch(() => {});
      pool.suspend();
    },

    handleOnline(): void {
      if (!started) return;
      pool.reconnectNow();
    },

    destroy(): void {
      dm.destroy();
      spaceSignal.destroy();
      if (feedFlushTimer) clearTimeout(feedFlushTimer);
      if (engagementFlushTimer) clearTimeout(engagementFlushTimer);
      if (threadFlushTimer) clearTimeout(threadFlushTimer);
      for (const timer of profileBatches.values()) clearTimeout(timer);
      profileBatches.clear();
      for (const collector of [...collectors.values()]) collector.done();
      for (const waiter of publishWaiters.values()) clearTimeout(waiter.timer);
      publishWaiters.clear();
      pool.destroy();
    },
  };
}
