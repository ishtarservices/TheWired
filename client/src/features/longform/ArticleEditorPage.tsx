import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { useAppSelector } from "@/store/hooks";
import { Spinner } from "@/components/ui/Spinner";
import { ArticleEditor, type ArticleSeed } from "./ArticleEditor";
import { useArticle } from "./useArticle";
import type { ArticleVisibility } from "./useArticleDraft";

/** Route component for `/write` (new) and `/write/:naddr` (edit). */
export function ArticleEditorPage() {
  const { naddr } = useParams<{ naddr: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  if (naddr) return <EditArticleLoader naddr={naddr} />;

  const space = params.get("space") ?? undefined;
  const channel = params.get("channel") ?? undefined;
  // Optional prefill handed in via router state (e.g. from the AI "Publish as article").
  const seed = (location.state as { articleSeed?: ArticleSeed } | null)?.articleSeed;
  return (
    <ArticleEditor
      mode="new"
      seed={seed}
      initialSpaceId={space}
      initialChannelId={channel}
      onPublished={(n) => navigate(`/article/${n}`)}
      onCancel={() => navigate(-1)}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      {children}
    </div>
  );
}

function EditArticleLoader({ naddr }: { naddr: string }) {
  const navigate = useNavigate();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const { article, raw, loading, notFound } = useArticle(naddr);

  if (loading) {
    return (
      <Centered>
        <Spinner size="lg" />
      </Centered>
    );
  }

  if (notFound || !article || !raw) {
    return (
      <Centered>
        <p className="text-sm text-muted">This article could not be found.</p>
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg bg-surface-hover px-4 py-2 text-sm text-heading hover:bg-surface-hover/80"
        >
          Go back
        </button>
      </Centered>
    );
  }

  if (article.pubkey !== myPubkey) {
    return (
      <Centered>
        <p className="text-sm text-muted">You can only edit your own articles.</p>
        <button
          onClick={() => navigate(`/article/${naddr}`)}
          className="rounded-lg bg-surface-hover px-4 py-2 text-sm text-heading hover:bg-surface-hover/80"
        >
          Read it instead
        </button>
      </Centered>
    );
  }

  const hTag = raw.tags.find((t) => t[0] === "h")?.[1];
  const channelTag = raw.tags.find((t) => t[0] === "channel")?.[1];
  const visibility: ArticleVisibility = hTag ? "space" : "public";

  return (
    <ArticleEditor
      mode="edit"
      initial={article}
      initialVisibility={visibility}
      initialSpaceId={hTag ?? ""}
      initialChannelId={channelTag ?? ""}
      onPublished={(n) => navigate(`/article/${n}`)}
      onCancel={() => navigate(-1)}
    />
  );
}
