import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { nip19 } from "nostr-tools";
import { useAppSelector } from "@/store/hooks";
import { Spinner } from "@/components/ui/Spinner";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ArticleReader } from "./ArticleReader";
import { useArticle } from "./useArticle";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

/** Route component for `/article/:id` — accepts a hex event id or an naddr/nevent/note. */
export function ArticlePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);
  const { article, raw, loading, notFound } = useArticle(id ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted">This article could not be found.</p>
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg bg-surface-hover px-4 py-2 text-sm text-heading hover:bg-surface-hover/80"
        >
          Go back
        </button>
      </div>
    );
  }

  const isAuthor = !!myPubkey && article.pubkey === myPubkey;
  const naddr = nip19.naddrEncode({
    kind: 30023,
    pubkey: article.pubkey,
    identifier: article.dTag,
    relays: [],
  });

  const handleDelete = async () => {
    if (!myPubkey) return;
    setDeleting(true);
    try {
      // Space-exclusive articles live on the space host relay — delete them there.
      const hTag = raw?.tags.find((t) => t[0] === "h")?.[1];
      const host = hTag ? spaces.find((s) => s.id === hTag)?.hostRelay : undefined;
      const addr = `30023:${article.pubkey}:${article.dTag}`;
      const unsigned = buildDeletionEvent(myPubkey, { addressableIds: [addr] });
      await signAndPublish(unsigned, host ? [host] : undefined);
      navigate(-1);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ArticleReader
        article={article}
        onBack={() => navigate(-1)}
        onEdit={isAuthor ? () => navigate(`/write/${naddr}`) : undefined}
        onDelete={isAuthor ? () => setConfirmDelete(true) : undefined}
      />

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border card-glass p-5">
            <h3 className="text-base font-semibold text-heading">Delete this article?</h3>
            <p className="mt-1 text-sm text-soft">
              This publishes a deletion request to relays. It can't be guaranteed to remove every
              copy, but compliant relays and clients will drop it.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete article"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
