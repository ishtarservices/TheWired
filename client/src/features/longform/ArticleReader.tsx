import { ArrowLeft, Zap, Pencil, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useZap } from "../wallet/WalletProvider";
import { ArticleMarkdown } from "./ArticleMarkdown";
import type { LongFormArticle } from "../../types/media";

interface ArticleReaderProps {
  article: LongFormArticle;
  onBack: () => void;
  /** Shown only for the author (provided by the reader route). */
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ArticleReader({ article, onBack, onEdit, onDelete }: ArticleReaderProps) {
  const { profile } = useProfile(article.pubkey);
  const { openZap } = useZap();
  const authorName =
    profile?.display_name ||
    profile?.name ||
    article.pubkey.slice(0, 8) + "...";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft size={16} />
          Back
        </Button>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={onEdit}
                className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-heading transition-colors hover:bg-surface-hover/80"
              >
                <Pencil size={13} />
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                <Trash2 size={13} />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {article.image && (
        <img
          src={article.image}
          alt={article.title}
          className="h-48 w-full object-cover"
        />
      )}

      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="text-2xl font-bold text-heading">{article.title}</h1>

        <div className="mt-4 flex items-center gap-3">
          <Avatar src={profile?.picture} alt={authorName} size="sm" />
          <div>
            <div className="text-sm font-medium text-heading">
              {authorName}
            </div>
            {article.publishedAt && (
              <div className="text-xs text-muted">
                {new Date(article.publishedAt * 1000).toLocaleDateString()}
              </div>
            )}
          </div>
          <button
            onClick={() => openZap({ recipientPubkey: article.pubkey })}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-yellow-400/10 px-3 py-1.5 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-400/20"
            title="Zap author"
          >
            <Zap size={14} />
            Zap
          </button>
        </div>

        {article.hashtags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.hashtags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary-soft"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-8">
          <ArticleMarkdown content={article.content} />
        </div>
      </div>
    </div>
  );
}
