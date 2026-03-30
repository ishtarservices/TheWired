import { useCallback } from "react";
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
