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
    // Feed channels: scoped by member pubkeys
    if (space.memberPubkeys.length === 0) return;
    filter = buildSpaceFeedFilter(
      space.memberPubkeys,
      route.kinds,
      route.pageSize,
    );
  }

  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: [space.hostRelay],
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

// ── Feed pagination ──────────────────────────────────────────────

/**
 * Refresh a space feed channel: fetch newer events (since newestAt).
 * Creates a one-shot subscription that closes after EOSE.
 */
export function refreshSpaceFeed(
  space: Space,
  channelType: string,
): void {
  const route = getSpaceChannelRoute(channelType);
  if (!route || route.filterMode === "htag") return;
  if (space.memberPubkeys.length === 0) return;

  const contextId = `${space.id}:${channelType}`;
  const meta = store.getState().feed.meta[contextId];

  store.dispatch(setRefreshing({ contextId, value: true }));

  const filter: NostrFilter = {
    authors: space.memberPubkeys,
    kinds: route.kinds,
    limit: route.pageSize,
  };

  // Only add since if we have a previous newest timestamp
  if (meta?.newestAt) {
    filter.since = meta.newestAt;
  }

  subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: [space.hostRelay],
    onEOSE: () => {
      store.dispatch(setRefreshing({ contextId, value: false }));
    },
  });
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
  if (space.memberPubkeys.length === 0) return;

  const contextId = `${space.id}:${channelType}`;
  const meta = store.getState().feed.meta[contextId];
  if (!meta?.oldestAt) return; // Nothing loaded yet, nothing to paginate from

  store.dispatch(setLoadingMore({ contextId, value: true }));

  const filter: NostrFilter = {
    authors: space.memberPubkeys,
    kinds: route.kinds,
    until: meta.oldestAt - 1, // Exclusive: events older than our oldest
    limit: route.pageSize,
  };

  const previousOldest = meta.oldestAt;

  const subId = subscriptionManager.subscribe({
    filters: [filter],
    relayUrls: [space.hostRelay],
    onEOSE: () => {
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
}
