/**
 * Compose + publish a kind:30023 long-form article from AI output. There is no
 * pre-existing article composer in the app, so this is the minimal title/summary/
 * image/tags form over {@link buildArticle} + signAndPublish.
 */
import { useState } from "react";
import { X, Newspaper, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { store } from "@/store";
import { buildArticle } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";

export function ArticleComposeModal({
  open,
  onClose,
  initialContent,
  initialTitle,
}: {
  open: boolean;
  onClose: () => void;
  initialContent: string;
  initialTitle?: string;
}) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [summary, setSummary] = useState("");
  const [image, setImage] = useState("");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState(initialContent);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPublish = title.trim().length > 0 && content.trim().length > 0 && !publishing;

  const publish = async () => {
    if (!canPublish) return;
    const pubkey = store.getState().identity.pubkey;
    if (!pubkey) {
      setError("Not logged in");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const unsigned = buildArticle(pubkey, {
        content: content.trim(),
        title: title.trim(),
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        hashtags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      await signAndPublish(unsigned);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish article");
    } finally {
      setPublishing(false);
    }
  };

  const field =
    "w-full rounded-xl border border-border bg-field px-3 py-2 text-sm text-heading placeholder-muted outline-none focus:border-primary/30";

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border card-glass shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Newspaper size={16} className="text-primary" />
            <h2 className="text-base font-semibold text-heading">Publish as article</h2>
          </div>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title *"
            className={field}
            autoFocus
          />
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Summary (optional)"
            className={field}
          />
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="Header image URL (optional)"
            className={field}
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Tags, comma-separated (optional)"
            className={field}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="Article content (Markdown)"
            className={`${field} resize-none font-mono text-xs`}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={publish} disabled={!canPublish}>
            {publishing && <Loader2 size={14} className="animate-spin" />}
            Publish
          </Button>
        </div>
      </div>
    </Modal>
  );
}
