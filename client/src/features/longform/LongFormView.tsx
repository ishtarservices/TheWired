import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PenSquare } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { selectSpaceArticles, parseChannelIdPart } from "../../features/spaces/spaceSelectors";
import { ArticleCard } from "./ArticleCard";
import { ArticleReader } from "./ArticleReader";
import { parseLongFormEvent } from "./useLongForm";
import { useFeedPagination } from "../../features/spaces/useFeedPagination";
import { FeedToolbar } from "../../features/spaces/FeedToolbar";
import { LoadMoreButton } from "../../features/spaces/LoadMoreButton";
import { selectFriendsFeedArticles } from "../../features/friends/friendsFeedSelectors";
import { FRIENDS_FEED_ID } from "../../features/friends/friendsFeedConstants";
import { FeedPrefsButton } from "../../features/friends/FeedPrefsButton";
import type { LongFormArticle } from "../../types/media";

export function LongFormView() {
  const navigate = useNavigate();
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;
  // The Feed gets mute/hidden/word filtering; spaces keep the plain selector.
  const articleEvents = useAppSelector(
    isFriendsFeed ? selectFriendsFeedArticles : selectSpaceArticles,
  );
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpace = useAppSelector((s) =>
    s.spaces.list.find((sp) => sp.id === s.spaces.activeSpaceId),
  );
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const [activeArticle, setActiveArticle] = useState<LongFormArticle | null>(
    null,
  );
  const { meta, refresh, loadMore } = useFeedPagination("articles");

  const articles = useMemo(
    () =>
      articleEvents
        .map(parseLongFormEvent)
        .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)),
    [articleEvents],
  );

  if (activeArticle) {
    return (
      <ArticleReader
        article={activeArticle}
        onBack={() => setActiveArticle(null)}
      />
    );
  }

  // Only offer authoring where it can actually succeed: a writable space with a
  // relay to publish to. Read-only / feed spaces never show the button, so users
  // aren't led to a publish that the host-relay guard would block.
  const canWrite =
    !!myPubkey && !!activeSpace && activeSpace.mode === "read-write" && !!activeSpace.hostRelay;

  const writeHref = () => {
    const params = new URLSearchParams({ space: activeSpaceId ?? "" });
    // activeChannelId is the composite `${spaceId}:${channel.id}` — the editor's
    // channel dropdown matches on the raw SpaceChannel.id, so pass that part only.
    const channelPart = parseChannelIdPart(activeChannelId);
    if (channelPart) params.set("channel", channelPart);
    return `/write?${params.toString()}`;
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <FeedToolbar
        isRefreshing={meta.isRefreshing}
        onRefresh={refresh}
        rightSlot={
          isFriendsFeed ? (
            <FeedPrefsButton channelType="articles" />
          ) : canWrite ? (
            <button
              onClick={() => navigate(writeHref())}
              className="flex items-center gap-1.5 rounded-md bg-primary/20 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/30"
            >
              <PenSquare size={13} />
              Write article
            </button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        {articles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted">No articles yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {articles.map((article) => (
              <ArticleCard
                key={article.eventId}
                article={article}
                onClick={() => setActiveArticle(article)}
              />
            ))}
            <LoadMoreButton
              isLoading={meta.isLoadingMore}
              hasMore={meta.hasMore}
              onLoadMore={loadMore}
            />
          </div>
        )}
      </div>
    </div>
  );
}
