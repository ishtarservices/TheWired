import { useCallback, useEffect, useRef } from "react";
import { useAppSelector } from "../../store/hooks";
import { refreshSpaceFeed, loadMoreSpaceFeed, refreshFriendsFeed, loadMoreFriendsFeed } from "../../lib/nostr/groupSubscriptions";
import { selectActiveSpace } from "./spaceSelectors";
import { FRIENDS_FEED_ID } from "../friends/friendsFeedConstants";
import type { FeedMeta } from "../../store/slices/feedSlice";

const DEFAULT_META: FeedMeta = {
  isRefreshing: false,
  isLoadingMore: false,
  hasMore: true,
  newestAt: 0,
  oldestAt: 0,
};

/**
 * Hook for feed refresh/load-more pagination.
 * Returns meta state + callbacks for the active space + channel type.
 *
 * Auto-fetches on mount when the feed context has no data yet,
 * so feeds like MediaFeed don't require a prior visit to NotesFeed.
 */
export function useFeedPagination(channelType: string) {
  const activeSpace = useAppSelector(selectActiveSpace);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;

  const contextId = isFriendsFeed
    ? `${FRIENDS_FEED_ID}:${channelType}`
    : activeSpace
      ? `${activeSpace.id}:${channelType}`
      : "";

  const meta = useAppSelector(
    (s) => (contextId ? s.feed.meta[contextId] : undefined) ?? DEFAULT_META,
  );

  // Auto-fetch when the feed is empty and no fetch is in progress.
  // Uses `initial: true` so the fetch is a full page (no `since` filter).
  // Without this, cross-indexed timestamps (e.g. notes with media setting
  // the media feed's newestAt) would cause partial fetches that miss
  // older events the feed hasn't actually loaded.
  const autoFetchedRef = useRef("");

  // Check actual event count — newestAt alone can be > 0 from cross-indexed
  // events even when the feed has no items of its own yet.
  const feedEventCount = useAppSelector((s) => {
    if (!contextId) return 0;
    return s.events.spaceFeeds[contextId]?.length ?? 0;
  });

  useEffect(() => {
    if (!contextId || meta.isRefreshing) return;
    if (feedEventCount > 0) return; // already have data
    if (autoFetchedRef.current === contextId) return;

    autoFetchedRef.current = contextId;

    if (isFriendsFeed) {
      refreshFriendsFeed(channelType, true);
    } else if (activeSpace) {
      refreshSpaceFeed(activeSpace, channelType, true);
    }
  }, [contextId, feedEventCount, meta.isRefreshing, isFriendsFeed, activeSpace, channelType]);

  const refresh = useCallback(() => {
    if (meta.isRefreshing) return;
    if (isFriendsFeed) {
      refreshFriendsFeed(channelType);
    } else if (activeSpace) {
      refreshSpaceFeed(activeSpace, channelType);
    }
  }, [activeSpace, isFriendsFeed, channelType, meta.isRefreshing]);

  const loadMore = useCallback(() => {
    if (meta.isLoadingMore || !meta.hasMore) return;
    if (isFriendsFeed) {
      loadMoreFriendsFeed(channelType);
    } else if (activeSpace) {
      loadMoreSpaceFeed(activeSpace, channelType);
    }
  }, [activeSpace, isFriendsFeed, channelType, meta.isLoadingMore, meta.hasMore]);

  return { meta, refresh, loadMore };
}
