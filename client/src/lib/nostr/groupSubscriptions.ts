import { subscriptionManager } from "./subscriptionManager";
import { relayManager } from "./relayManager";
import { flushEventPipeline } from "./eventPipeline";
import { buildChannelFilter, buildSpaceFeedFilter } from "./filterBuilder";
import { getChannelRoute } from "./channelRoutes";
import { getSpaceChannelRoute } from "../../features/spaces/spaceChannelRoutes";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrFilter } from "../../types/nostr";
import type { Space } from "../../types/space";
import { isNip29Native } from "../../features/spaces/spaceType";
import { seedNativeSpaceConfig } from "../../features/spaces/nip29SpaceSync";
import { layoutDTags } from "../../features/spaces/channelLayout";
import { wiredRelaysDTag, resolveRelaySet } from "../../features/spaces/relaySet";
import { store } from "../../store";
import { setChannelSubscription, removeChannelSubscription } from "../../store/slices/spacesSlice";
import { setRefreshing, setLoadingMore, setHasMore } from "../../store/slices/feedSlice";

// ── Background chat subscriptions ────────────────────────────────
// Always-on lightweight subs so notifications fire even when the user is
// viewing a different space (mirrors the global DM gift-wrap subscription).
//
// Collapsed by HOST RELAY: one sub per distinct hostRelay carries every joined
// space's id in a single multi-value `#h` filter (NIP-01 OR semantics) instead
// of one sub per space — 27 spaces on one relay → 1 sub, not 27. Grouping by
// hostRelay stays correct under federation (spaces on different relays each get
// their own combined sub). Notifications are unaffected: each event is matched
// to its space by its own `#h` tag, not by which sub delivered it.

/** hostRelay → background chat subscription ID */
const hostRelaySubs = new Map<string, string>();
/** hostRelay → set of joined space ids fed by that host's sub */
const spacesByHost = new Map<string, Set<string>>();
/** spaceId → hostRelay (reverse lookup so closeBgChatSub resolves the host
 *  before the space is removed from Redux) */
const spaceHost = new Map<string, string>();

/** Recent-only window for the always-on sub (full history loads on entering). */
function defaultSince(): number {
  return Math.floor(Date.now() / 1000) - 60;
}

/** (Re)open the single bg chat sub for a host with its current space-id set.
 *  Closes any existing sub for that host first — NIP-01 has no "edit REQ". */
function openHostSub(host: string, since: number = defaultSince()): void {
  const existing = hostRelaySubs.get(host);
  if (existing) {
    subscriptionManager.close(existing);
    hostRelaySubs.delete(host);
  }
  const ids = [...(spacesByHost.get(host) ?? [])].filter(Boolean);
  if (ids.length === 0) return;

  const subId = subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.CHAT_MESSAGE, EVENT_KINDS.DELETION, EVENT_KINDS.MOD_DELETE_EVENT],
        "#h": ids,
        since,
      },
    ],
    relayUrls: [host],
  });
  hostRelaySubs.set(host, subId);
}

/**
 * Open background chat subscriptions for all joined spaces — one per host relay.
 * Called once at login after spaces are loaded from IndexedDB.
 */
export function startBackgroundChatSubs(spaces: Space[]): void {
  // Build the per-host id sets first, then open one sub per host (avoids N
  // close+reopen cycles when many spaces share a host).
  for (const space of spaces) {
    if (!space.hostRelay) continue;
    const set = spacesByHost.get(space.hostRelay) ?? new Set<string>();
    set.add(space.id);
    spacesByHost.set(space.hostRelay, set);
    spaceHost.set(space.id, space.hostRelay);
  }
  for (const host of spacesByHost.keys()) {
    openHostSub(host);
  }
}

/** Add a space to its host's background chat sub (idempotent). */
export function openBgChatSub(space: Space): void {
  if (!space.hostRelay) return;
  const set = spacesByHost.get(space.hostRelay) ?? new Set<string>();
  if (set.has(space.id)) return;
  set.add(space.id);
  spacesByHost.set(space.hostRelay, set);
  spaceHost.set(space.id, space.hostRelay);
  openHostSub(space.hostRelay);
}

/** Remove a space from its host's background chat sub (leave/kick/delete).
 *  Closes the host sub entirely once its last space leaves. */
export function closeBgChatSub(spaceId: string): void {
  const host = spaceHost.get(spaceId);
  if (!host) return;
  spaceHost.delete(spaceId);

  const set = spacesByHost.get(host);
  if (!set) return;
  set.delete(spaceId);

  if (set.size === 0) {
    const subId = hostRelaySubs.get(host);
    if (subId) subscriptionManager.close(subId);
    hostRelaySubs.delete(host);
    spacesByHost.delete(host);
  } else {
    openHostSub(host);
  }
}

/** Close all background chat subs (logout). */
export function stopAllBgChatSubs(): void {
  for (const subId of hostRelaySubs.values()) {
    subscriptionManager.close(subId);
  }
  hostRelaySubs.clear();
  spacesByHost.clear();
  spaceHost.clear();

  // Also tear down per-space metadata/layout subs and the client-space marker
  // map. Their underlying subs are closed by subscriptionManager.closeAll() at
  // teardown, but if the MAPS aren't cleared, enterSpace()/enterClientSpace()
  // early-return after an account switch (`if (spaceMetaSubs.has(id)) return;`)
  // and silently never re-subscribe metadata/layout for the new account.
  for (const subId of spaceMetaSubs.values()) subscriptionManager.close(subId);
  for (const subId of spaceLayoutSubs.values()) subscriptionManager.close(subId);
  spaceMetaSubs.clear();
  spaceLayoutSubs.clear();
  clientSpaceMetaSubs.clear();
}

// On reconnect, RelayConnection.resubscribe() re-sends the bg sub's original
// (now-stale) `since`, replaying the whole backlog since login. Rebuild that
// host's sub with a fresh `since` instead. Deferred to a microtask so it runs
// AFTER resubscribe(); we then CLOSE the stale sub and re-open from the last
// event we actually saw (minus a small buffer).
relayManager.onReconnect((relayUrl) => {
  if (!hostRelaySubs.has(relayUrl)) return;
  queueMicrotask(() => rebuildHostSub(relayUrl));
});

function rebuildHostSub(host: string): void {
  const oldSubId = hostRelaySubs.get(host);
  if (!oldSubId) return;
  const since = subscriptionManager.getReconnectSince(oldSubId) ?? defaultSince();
  openHostSub(host, since);
}

/** Active subscriptions per space for metadata */
const spaceMetaSubs = new Map<string, string>();
/** Active kind:30078 channel-layout subscriptions per native space (M4). */
const spaceLayoutSubs = new Map<string, string>();

/** Enter a space: fetch group metadata (kind:39000/39001/39002) + channel layout
 *  (kind:30078, ours + Obelisk's).
 *  SECURITY: when the relay's signing pubkey is known, pin it as the filter
 *  `authors` so forged group state (any pubkey reusing the group's d-tag) is
 *  never delivered. `applyNativeGroupEvent` enforces the same check again. The
 *  layout sub can't author-pin (admins are dynamic) — `parseLayoutEvent` checks
 *  authorization instead. */
export function enterSpace(groupId: string, relayUrl: string, relayPubkey?: string): void {
  if (spaceMetaSubs.has(groupId)) return;

  const filter: NostrFilter = {
    kinds: [
      EVENT_KINDS.GROUP_METADATA,
      EVENT_KINDS.GROUP_ADMINS,
      EVENT_KINDS.GROUP_MEMBERS,
    ],
    "#d": [groupId],
    limit: 3,
  };
  if (relayPubkey) filter.authors = [relayPubkey];

  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: [relayUrl],
  });
  spaceMetaSubs.set(groupId, subId);

  // One kind:30078 sub covers both overlays (routed by d-tag in the pipeline):
  // the channel layout (M4) and the mirror relay set (M9).
  const layoutSub = subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.APP_SPECIFIC_DATA],
        "#d": [
          ...layoutDTags({ id: groupId, hostRelay: relayUrl }),
          wiredRelaysDTag(groupId),
        ],
        limit: 6,
      },
    ],
    relayUrls: [relayUrl],
  });
  spaceLayoutSubs.set(groupId, layoutSub);
}

/** Close every channel subscription whose Redux key starts with `prefix` and
 *  drop it from `spaces.subscriptions`. Channel subs are keyed `spaceId:...`;
 *  the always-on background chat sub is NOT in this map (it lives in
 *  `hostRelaySubs`), so this never affects notifications. Used by the switch and
 *  leave entry points so the prior channel's REQ is always closed — even when the caller has
 *  already overwritten `activeChannelId` with the new channel before switching
 *  (the #38 leak: the old key was then unrecoverable from Redux). Also self-heals
 *  any prior-channel subs that leaked earlier in the session. */
function closeSpaceChannelSubs(prefix: string): void {
  const subs = store.getState().spaces.subscriptions;
  for (const [channelId, subId] of Object.entries(subs)) {
    if (channelId.startsWith(prefix)) {
      subscriptionManager.close(subId);
      store.dispatch(removeChannelSubscription(channelId));
    }
  }
}

/** Leave a space: close metadata sub + all channel subs */
export function leaveSpace(groupId: string): void {
  const metaSub = spaceMetaSubs.get(groupId);
  if (metaSub) {
    subscriptionManager.close(metaSub);
    spaceMetaSubs.delete(groupId);
  }
  const layoutSub = spaceLayoutSubs.get(groupId);
  if (layoutSub) {
    subscriptionManager.close(layoutSub);
    spaceLayoutSubs.delete(groupId);
  }

  closeSpaceChannelSubs(groupId + ":");
}

/** Switch to a channel: close old sub, open new one */
export function switchChannel(
  groupId: string,
  channelType: string,
  relayUrl: string,
  adminPubkeys?: string[],
): void {
  const channelId = `${groupId}:${channelType}`;

  // Close the previous channel sub(s) for this space (#38). The bg chat sub is
  // untouched (it's in hostRelaySubs, not Redux).
  closeSpaceChannelSubs(groupId + ":");

  // Open new subscription
  const route = getChannelRoute(channelType);
  if (!route) return;

  const filter = buildChannelFilter(route, groupId, {
    limit: route.pageSize,
    adminPubkeys,
  });

  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: [relayUrl],
  });

  store.dispatch(setChannelSubscription({ channelId, subId }));
}

// ── Client-defined spaces ──────────────────────────────────────────

/** Active metadata subscriptions per client space */
const clientSpaceMetaSubs = new Map<string, string>();

/** Enter a client-defined space: no relay metadata needed, just mark active */
export function enterClientSpace(space: Space): void {
  // For client spaces we don't fetch group metadata from relays
  // The space data is already in Redux from IndexedDB
  clientSpaceMetaSubs.set(space.id, "local");
}

/** Switch to a channel within a client-defined space */
export function switchSpaceChannel(
  space: Space,
  channelType: string,
  channelId?: string,
): void {
  // Use channel ID for the subscription key when available (supports multiple channels per type).
  // Falls back to channel type for legacy callers.
  const subKey = channelId ? `${space.id}:${channelId}` : `${space.id}:${channelType}`;

  // Close the previous channel sub(s) for this space (#38). The bg chat sub is
  // untouched (it's in hostRelaySubs, not Redux).
  closeSpaceChannelSubs(space.id + ":");

  const route = getSpaceChannelRoute(channelType);
  if (!route) return;

  let filter: NostrFilter;

  if (route.filterMode === "htag") {
    // Chat: scoped to space ID via h-tag
    filter = {
      kinds: route.kinds,
      "#h": [space.id],
      limit: route.pageSize,
    };
  } else {
    // Feed channels: for feed-mode spaces use curated feed sources,
    // for community spaces use all member pubkeys
    const authors =
      space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
    if (authors.length === 0) return;
    filter = buildSpaceFeedFilter(authors, route.kinds, route.pageSize);
  }

  // Chat (h-tag scoped) is read from the space's full relay set — the host
  // (authority) plus any mirrors (M9) — so history/live survive the authority
  // going offline; the pipeline dedups by event id. Feed channels (notes,
  // media, articles) use all read relays — members publish to their own relays.
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: route.filterMode === "htag"
      ? resolveRelaySet(space)
      : undefined,  // all read relays
  });

  store.dispatch(setChannelSubscription({ channelId: subKey, subId }));
}

/** Leave a client-defined space: close all subscriptions */
export function leaveClientSpace(spaceId: string): void {
  clientSpaceMetaSubs.delete(spaceId);
  closeSpaceChannelSubs(spaceId + ":");
}

// ── Unified entry points (work for all three space modes) ───────────────
// platform / decentralized-A-lite use the backend/client path; nip29-native
// additionally subscribes to relay-published 39000/39001/39002 metadata.

/** Enter any space: marks it active and (for native spaces) subscribes to the
 *  relay's NIP-29 group metadata so members/roles/name stay live. */
export function enterAnySpace(space: Space): void {
  enterClientSpace(space);
  if (isNip29Native(space)) {
    // Show known members immediately, then refine from 39001/39002.
    seedNativeSpaceConfig(space);
    enterSpace(space.id, space.hostRelay, space.relayPubkey);
  }
}

/** Switch channel for any space. Chat routes to the host relay (h-tag) for all
 *  modes; the native/backend split is handled inside switchSpaceChannel. */
export function switchAnyChannel(space: Space, channelType: string, channelId?: string): void {
  switchSpaceChannel(space, channelType, channelId);
}

/** Leave any space, closing the native metadata sub too when applicable. */
export function leaveAnySpace(spaceId: string): void {
  const space = store.getState().spaces.list.find((s) => s.id === spaceId);
  if (space && isNip29Native(space)) {
    leaveSpace(spaceId);
  }
  leaveClientSpace(spaceId);
}

// ── Friends Feed ─────────────────────────────────────────────────

import { FRIENDS_FEED_ID } from "../../features/friends/friendsFeedConstants";

/**
 * Enter the Friends Feed virtual space: subscribe to notes from the
 * user's follow list on their read relays.
 */
export function enterFriendsFeed(channelType: string): void {
  const state = store.getState();
  const followList = state.identity.followList;
  if (followList.length === 0) return;

  const channelId = `${FRIENDS_FEED_ID}:${channelType}`;

  // Close any existing Friends Feed subscription
  const oldSubId = state.spaces.subscriptions[channelId];
  if (oldSubId) {
    subscriptionManager.close(oldSubId);
    store.dispatch(removeChannelSubscription(channelId));
  }

  const route = getSpaceChannelRoute(channelType);
  if (!route) return;

  const filter: NostrFilter = {
    authors: followList.slice(0, 500), // Cap to avoid oversized filters
    kinds: route.kinds,
    limit: route.pageSize,
  };

  // Subscribe to all read relays (follow list authors publish to their own relays)
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: undefined, // all read relays
  });

  store.dispatch(setChannelSubscription({ channelId, subId }));
}

/** Switch channel within the Friends Feed */
export function switchFriendsFeedChannel(channelType: string): void {
  // Close the previous Friends Feed channel sub(s) (#38 twin) before enterFriendsFeed
  // opens the new one. Reads from Redux, not the caller-mutated activeChannelId.
  closeSpaceChannelSubs(FRIENDS_FEED_ID + ":");
  enterFriendsFeed(channelType);
}

/** Leave the Friends Feed: close all subscriptions */
export function leaveFriendsFeed(): void {
  closeSpaceChannelSubs(FRIENDS_FEED_ID + ":");
}

/**
 * Refresh the Friends Feed.
 * @param initial  When true, skip the `since` filter — used for first-load
 *                 so cross-indexed timestamps don't cause partial fetches.
 */
export function refreshFriendsFeed(channelType: string, initial = false): void {
  const state = store.getState();
  const followList = state.identity.followList;
  if (followList.length === 0) return;

  const route = getSpaceChannelRoute(channelType);
  if (!route) return;

  const contextId = `${FRIENDS_FEED_ID}:${channelType}`;
  const meta = state.feed.meta[contextId];

  store.dispatch(setRefreshing({ contextId, value: true }));

  const filter: NostrFilter = {
    authors: followList.slice(0, 500),
    kinds: route.kinds,
    limit: route.pageSize,
  };
  if (!initial && meta?.newestAt) {
    filter.since = meta.newestAt;
  }

  // One-shot: subscribeOnce closes the sub on EOSE/timeout/no-relays, so it can't
  // leak (this previously needed a manual settled flag + timeout + close).
  subscriptionManager
    .subscribeOnce({ filters: [filter], timeoutMs: PAGINATION_TIMEOUT_MS })
    .then(() => store.dispatch(setRefreshing({ contextId, value: false })));
}

/** Load older Friends Feed events */
export function loadMoreFriendsFeed(channelType: string): void {
  const state = store.getState();
  const followList = state.identity.followList;
  if (followList.length === 0) return;

  const route = getSpaceChannelRoute(channelType);
  if (!route) return;

  const contextId = `${FRIENDS_FEED_ID}:${channelType}`;
  const meta = state.feed.meta[contextId];
  if (!meta?.oldestAt) return;

  store.dispatch(setLoadingMore({ contextId, value: true }));

  const filter: NostrFilter = {
    authors: followList.slice(0, 500),
    kinds: route.kinds,
    until: meta.oldestAt - 1,
    limit: route.pageSize,
  };

  const previousOldest = meta.oldestAt;

  subscriptionManager
    .subscribeOnce({ filters: [filter], timeoutMs: PAGINATION_TIMEOUT_MS })
    .then(({ reason }) => {
      store.dispatch(setLoadingMore({ contextId, value: false }));
      // #78: only an honest all-relays EOSE concludes "no more older events". A
      // timeout/no-relays says nothing about whether more exist → keep hasMore.
      if (reason !== "all-eose") return;
      flushEventPipeline(); // apply buffered events so oldestAt reflects this page
      const updatedMeta = store.getState().feed.meta[contextId];
      if (!updatedMeta || updatedMeta.oldestAt >= previousOldest) {
        store.dispatch(setHasMore({ contextId, value: false }));
      }
    });
}

// ── Feed pagination ──────────────────────────────────────────────

/**
 * Refresh a space feed channel: fetch newer events (since newestAt).
 * Creates a one-shot subscription that closes after EOSE.
 */
/** Timeout for one-shot pagination subscriptions (ms) */
const PAGINATION_TIMEOUT_MS = 30_000;

/**
 * Refresh a space feed channel: fetch newer events (since newestAt).
 * @param initial  When true, skip the `since` filter — used for first-load
 *                 so cross-indexed timestamps don't cause partial fetches.
 */
export function refreshSpaceFeed(
  space: Space,
  channelType: string,
  initial = false,
  channelId?: string,
): void {
  const route = getSpaceChannelRoute(channelType);
  if (!route || route.filterMode === "htag") return;

  const authors =
    space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
  if (authors.length === 0) return;

  const contextId = channelId ? `${space.id}:${channelId}` : `${space.id}:${channelType}`;
  const meta = store.getState().feed.meta[contextId];

  store.dispatch(setRefreshing({ contextId, value: true }));

  const filter: NostrFilter = {
    authors,
    kinds: route.kinds,
    limit: route.pageSize,
  };

  // Only add since for incremental refreshes, not initial loads.
  // Cross-indexed events (e.g. notes with media → media feed) can set
  // newestAt before the feed's own subscription runs, causing a since
  // filter that skips older events the feed hasn't actually fetched.
  if (!initial && meta?.newestAt) {
    filter.since = meta.newestAt;
  }

  // Feed channels always use all read relays — members publish notes to their own
  // relays. One-shot: subscribeOnce closes the sub on every path (no leak).
  subscriptionManager
    .subscribeOnce({ filters: [filter], timeoutMs: PAGINATION_TIMEOUT_MS })
    .then(() => store.dispatch(setRefreshing({ contextId, value: false })));
}

/**
 * Load older events for a space feed channel (until oldestAt).
 * Creates a one-shot subscription that closes after EOSE.
 */
export function loadMoreSpaceFeed(
  space: Space,
  channelType: string,
  channelId?: string,
): void {
  const route = getSpaceChannelRoute(channelType);
  if (!route || route.filterMode === "htag") return;

  const authors =
    space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
  if (authors.length === 0) return;

  const contextId = channelId ? `${space.id}:${channelId}` : `${space.id}:${channelType}`;
  const meta = store.getState().feed.meta[contextId];
  if (!meta?.oldestAt) return; // Nothing loaded yet, nothing to paginate from

  store.dispatch(setLoadingMore({ contextId, value: true }));

  const filter: NostrFilter = {
    authors,
    kinds: route.kinds,
    until: meta.oldestAt - 1, // Exclusive: events older than our oldest
    limit: route.pageSize,
  };

  const previousOldest = meta.oldestAt;

  subscriptionManager
    .subscribeOnce({ filters: [filter], timeoutMs: PAGINATION_TIMEOUT_MS })
    .then(({ reason }) => {
      store.dispatch(setLoadingMore({ contextId, value: false }));
      // #78: only an honest all-relays EOSE concludes "no more older events". A
      // timeout/no-relays says nothing about whether more exist → keep hasMore.
      if (reason !== "all-eose") return;
      flushEventPipeline(); // apply buffered events so oldestAt reflects this page
      const updatedMeta = store.getState().feed.meta[contextId];
      if (!updatedMeta || updatedMeta.oldestAt >= previousOldest) {
        store.dispatch(setHasMore({ contextId, value: false }));
      }
    });
}
