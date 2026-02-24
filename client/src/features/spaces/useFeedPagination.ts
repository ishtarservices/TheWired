import { useCallback } from "react";
import { useAppSelector } from "../../store/hooks";
import { refreshSpaceFeed, loadMoreSpaceFeed } from "../../lib/nostr/groupSubscriptions";
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
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) ?? null : null;
  });

  const contextId = activeSpace ? `${activeSpace.id}:${channelType}` : "";
  const meta = useAppSelector(
    (s) => (contextId ? s.feed.meta[contextId] : undefined) ?? DEFAULT_META,
  );

  const refresh = useCallback(() => {
    if (!activeSpace || meta.isRefreshing) return;
    refreshSpaceFeed(activeSpace, channelType);
  }, [activeSpace, channelType, meta.isRefreshing]);

  const loadMore = useCallback(() => {
    if (!activeSpace || meta.isLoadingMore || !meta.hasMore) return;
    loadMoreSpaceFeed(activeSpace, channelType);
  }, [activeSpace, channelType, meta.isLoadingMore, meta.hasMore]);

  return { meta, refresh, loadMore };
}
