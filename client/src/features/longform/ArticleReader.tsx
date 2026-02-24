import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ArrowLeft } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import type { LongFormArticle } from "../../types/media";

interface ArticleReaderProps {
  article: LongFormArticle;
  onBack: () => void;
}

export function ArticleReader({ article, onBack }: ArticleReaderProps) {
  const { profile } = useProfile(article.pubkey);
  const authorName =
    profile?.display_name ||
    profile?.name ||
    article.pubkey.slice(0, 8) + "...";

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-edge px-6 py-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowLeft size={16} />
          Back
        </Button>
      </div>

      {article.image && (
        <img
          src={article.image}
          alt={article.title}
          className="h-48 w-full object-cover"
        />
      )}

      <div className="mx-auto max-w-2xl px-6 py-8">
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
        </div>

        {article.hashtags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {article.hashtags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-card px-2.5 py-0.5 text-xs text-soft"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="prose prose-invert mt-8 max-w-none prose-headings:text-heading prose-p:text-body prose-a:text-neon prose-code:text-neon-soft prose-pre:bg-panel">
          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {article.content}
          </Markdown>
        </div>
      </div>
    </div>
  );
}
