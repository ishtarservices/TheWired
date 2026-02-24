import { BookOpen } from "lucide-react";
import type { LongFormArticle } from "../../types/media";
import { formatDistanceToNow } from "date-fns";

interface ArticleCardProps {
  article: LongFormArticle;
  onClick?: () => void;
}

export function ArticleCard({ article, onClick }: ArticleCardProps) {
  const time = article.publishedAt
    ? formatDistanceToNow(article.publishedAt * 1000, { addSuffix: true })
    : "";

  return (
    <button
      onClick={onClick}
      className="flex w-full gap-4 rounded-lg border-neon-glow bg-card p-4 text-left transition-all duration-150 hover-lift hover:glow-neon"
    >
      {article.image ? (
        <img
          src={article.image}
          alt={article.title}
          className="h-24 w-36 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="flex h-24 w-36 shrink-0 items-center justify-center rounded-md bg-card-hover">
          <BookOpen size={24} className="text-faint" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-heading">{article.title}</h3>
        {article.summary && (
          <p className="mt-1 line-clamp-2 text-xs text-soft">
            {article.summary}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          {time && <span className="text-xs text-muted">{time}</span>}
          {article.hashtags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-card-hover px-1.5 py-0.5 text-xs text-soft"
            >
              #{tag}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}
