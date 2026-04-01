import { subscriptionManager } from "./subscriptionManager";
import { buildChannelFilter, buildSpaceFeedFilter } from "./filterBuilder";
import { getChannelRoute } from "./channelRoutes";
import { getSpaceChannelRoute } from "../../features/spaces/spaceChannelRoutes";
import { EVENT_KINDS } from "../../types/nostr";
import type { NostrFilter } from "../../types/nostr";
import type { Space } from "../../types/space";
import { store } from "../../store";
import { setChannelSubscription, removeChannelSubscription } from "../../store/slices/spacesSlice";
import { setRefreshing, setLoadingMore, setHasMore } from "../../store/slices/feedSlice";

// ── Background chat subscriptions ────────────────────────────────
// Always-on lightweight subs for all joined spaces so notifications
// fire even when the user is viewing a different space.
// Mirrors how DMs use a global gift-wrap subscription.

/** Map of spaceId → background chat subscription ID */
const bgChatSubs = new Map<string, string>();

/**
 * Open background chat subscriptions for all joined spaces.
 * Called once at login after spaces are loaded from IndexedDB.
 */
export function startBackgroundChatSubs(spaces: Space[]): void {
  for (const space of spaces) {
    openBgChatSub(space);
  }
}

/** Open a single background chat sub for a space (idempotent) */
export function openBgChatSub(space: Space): void {
  if (bgChatSubs.has(space.id)) return;

  const subId = subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.CHAT_MESSAGE, EVENT_KINDS.DELETION, EVENT_KINDS.MOD_DELETE_EVENT],
        "#h": [space.id],
        // Only fetch recent — historical messages loaded when entering space
        since: Math.floor(Date.now() / 1000) - 60,
      },
    ],
    relayUrls: [space.hostRelay],
  });

  bgChatSubs.set(space.id, subId);
}

/** Close a single background chat sub (when leaving/deleting a space) */
export function closeBgChatSub(spaceId: string): void {
  const subId = bgChatSubs.get(spaceId);
  if (subId) {
    subscriptionManager.close(subId);
    bgChatSubs.delete(spaceId);
  }
}

/** Close all background chat subs (logout) */
export function stopAllBgChatSubs(): void {
  for (const [, subId] of bgChatSubs) {
    subscriptionManager.close(subId);
  }
  bgChatSubs.clear();
}

/** Active subscriptions per space for metadata */
const spaceMetaSubs = new Map<string, string>();

/** Enter a space: fetch group metadata (kind:39000/39001/39002) */
export function enterSpace(groupId: string, relayUrl: string): void {
  if (spaceMetaSubs.has(groupId)) return;

  const subId = subscriptionManager.subscribe({
    filters: [
      {
        kinds: [
          EVENT_KINDS.GROUP_METADATA,
          EVENT_KINDS.GROUP_ADMINS,
          EVENT_KINDS.GROUP_MEMBERS,
        ],
        "#d": [groupId],
        limit: 3,
      },
    ],
    relayUrls: [relayUrl],
  });

  spaceMetaSubs.set(groupId, subId);
}

/** Leave a space: close metadata sub + all channel subs */
export function leaveSpace(groupId: string): void {
  const metaSub = spaceMetaSubs.get(groupId);
  if (metaSub) {
    subscriptionManager.close(metaSub);
    spaceMetaSubs.delete(groupId);
  }

  // Close all channel subs for this space
  const state = store.getState();
  for (const [channelId, subId] of Object.entries(state.spaces.subscriptions)) {
    if (channelId.startsWith(groupId + ":")) {
      subscriptionManager.close(subId);
      store.dispatch(removeChannelSubscription(channelId));
    }
  }
}

/** Switch to a channel: close old sub, open new one */
export function switchChannel(
  groupId: string,
  channelType: string,
  relayUrl: string,
  adminPubkeys?: string[],
): void {
  const channelId = `${groupId}:${channelType}`;
  const state = store.getState();

  // Close previous channel subscription for this space
  const activeChannelId = state.spaces.activeChannelId;
  if (activeChannelId) {
    const oldSubId = state.spaces.subscriptions[activeChannelId];
    if (oldSubId) {
      subscriptionManager.close(oldSubId);
      store.dispatch(removeChannelSubscription(activeChannelId));
    }
  }

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
): void {
  const channelId = `${space.id}:${channelType}`;
  const state = store.getState();

  // Close previous channel subscription for this space
  const activeChannelId = state.spaces.activeChannelId;
  if (activeChannelId) {
    const oldSubId = state.spaces.subscriptions[activeChannelId];
    if (oldSubId) {
      subscriptionManager.close(oldSubId);
      store.dispatch(removeChannelSubscription(activeChannelId));
    }
  }

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

  // Chat (h-tag scoped) lives exclusively on the host relay.
  // Feed channels (notes, media, articles) use all read relays for both
  // read and community spaces — members publish notes to their own relays,
  // not the space's host relay.
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: route.filterMode === "htag"
      ? [space.hostRelay]
      : undefined,  // all read relays
  });

  store.dispatch(setChannelSubscription({ channelId, subId }));
}

/** Leave a client-defined space: close all subscriptions */
export function leaveClientSpace(spaceId: string): void {
  clientSpaceMetaSubs.delete(spaceId);

  const state = store.getState();
  for (const [channelId, subId] of Object.entries(state.spaces.subscriptions)) {
    if (channelId.startsWith(spaceId + ":")) {
      subscriptionManager.close(subId);
      store.dispatch(removeChannelSubscription(channelId));
    }
  }
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
  const state = store.getState();

  // Close previous Friends Feed channel subscription
  const activeChannelId = state.spaces.activeChannelId;
  if (activeChannelId && activeChannelId.startsWith(FRIENDS_FEED_ID + ":")) {
    const oldSubId = state.spaces.subscriptions[activeChannelId];
    if (oldSubId) {
      subscriptionManager.close(oldSubId);
      store.dispatch(removeChannelSubscription(activeChannelId));
    }
  }

  enterFriendsFeed(channelType);
}

/** Leave the Friends Feed: close all subscriptions */
export function leaveFriendsFeed(): void {
  const state = store.getState();
  for (const [channelId, subId] of Object.entries(state.spaces.subscriptions)) {
    if (channelId.startsWith(FRIENDS_FEED_ID + ":")) {
      subscriptionManager.close(subId);
      store.dispatch(removeChannelSubscription(channelId));
    }
  }
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

  let settled = false;
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: undefined,
    onEOSE: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      store.dispatch(setRefreshing({ contextId, value: false }));
    },
  });

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    store.dispatch(setRefreshing({ contextId, value: false }));
    subscriptionManager.close(subId);
  }, PAGINATION_TIMEOUT_MS);
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

  let settled = false;
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: undefined,
    onEOSE: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      store.dispatch(setLoadingMore({ contextId, value: false }));

      const updatedMeta = store.getState().feed.meta[contextId];
      if (!updatedMeta || updatedMeta.oldestAt >= previousOldest) {
        store.dispatch(setHasMore({ contextId, value: false }));
      }

      subscriptionManager.close(subId);
    },
  });

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    store.dispatch(setLoadingMore({ contextId, value: false }));
    subscriptionManager.close(subId);
  }, PAGINATION_TIMEOUT_MS);
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
): void {
  const route = getSpaceChannelRoute(channelType);
  if (!route || route.filterMode === "htag") return;

  const authors =
    space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
  if (authors.length === 0) return;

  const contextId = `${space.id}:${channelType}`;
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

  // Feed channels always use all read relays — members publish notes to
  // their own relays, not the space's host relay.
  const relayUrls: string[] | undefined = undefined;

  let settled = false;
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls,
    onEOSE: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      store.dispatch(setRefreshing({ contextId, value: false }));
    },
  });

  // Safety timeout: if EOSE never arrives, unblock UI and close sub
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    store.dispatch(setRefreshing({ contextId, value: false }));
    subscriptionManager.close(subId);
  }, PAGINATION_TIMEOUT_MS);
}

/**
 * Load older events for a space feed channel (until oldestAt).
 * Creates a one-shot subscription that closes after EOSE.
 */
export function loadMoreSpaceFeed(
  space: Space,
  channelType: string,
): void {
  const route = getSpaceChannelRoute(channelType);
  if (!route || route.filterMode === "htag") return;

  const authors =
    space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
  if (authors.length === 0) return;

  const contextId = `${space.id}:${channelType}`;
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

  let settled = false;
  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: undefined, // all read relays — members publish to their own relays
    onEOSE: () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      store.dispatch(setLoadingMore({ contextId, value: false }));

      // Check if oldestAt changed -- if not, no new events arrived => no more to load
      const updatedMeta = store.getState().feed.meta[contextId];
      if (!updatedMeta || updatedMeta.oldestAt >= previousOldest) {
        store.dispatch(setHasMore({ contextId, value: false }));
      }

      // Close the one-shot subscription
      subscriptionManager.close(subId);
    },
  });

  // Safety timeout: if EOSE never arrives, unblock UI and close sub
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    store.dispatch(setLoadingMore({ contextId, value: false }));
    subscriptionManager.close(subId);
  }, PAGINATION_TIMEOUT_MS);
}
