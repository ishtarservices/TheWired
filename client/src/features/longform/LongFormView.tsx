import { useState, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { selectSpaceArticles } from "../../features/spaces/spaceSelectors";
import { ArticleCard } from "./ArticleCard";
import { ArticleReader } from "./ArticleReader";
import { parseLongFormEvent } from "./useLongForm";
import { useFeedPagination } from "../../features/spaces/useFeedPagination";
import { FeedToolbar } from "../../features/spaces/FeedToolbar";
import { LoadMoreButton } from "../../features/spaces/LoadMoreButton";
import type { LongFormArticle } from "../../types/media";

export function LongFormView() {
  const articleEvents = useAppSelector(selectSpaceArticles);
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <FeedToolbar isRefreshing={meta.isRefreshing} onRefresh={refresh} />
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
