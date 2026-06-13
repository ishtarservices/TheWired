import { useCallback, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Send, Pilcrow, Code, Eye } from "lucide-react";
import { nanoid } from "nanoid";
import { nip19 } from "nostr-tools";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useMarkdownShortcuts } from "@/hooks/useMarkdownShortcuts";
import { useAppSelector } from "@/store/hooks";
import { buildArticle } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { blossomUpload } from "@/lib/api/blossom";
import { ArticleToolbar } from "./ArticleToolbar";
import { ArticleVisibilityPicker } from "./ArticleVisibilityPicker";
import { ArticleMarkdown } from "./ArticleMarkdown";
import { CoverImageField } from "./CoverImageField";
import { TagsInput } from "./TagsInput";
import { useArticleDraftAutosave } from "./useArticleDraft";
import { deleteDraft, getDraft } from "@/lib/db/articleDraftStore";
import type {
  ArticleDraftFields,
  ArticleVisibility,
  LongFormArticle,
} from "@/types/media";

// ProseMirror is heavy — only load the WYSIWYG surface when the editor opens.
const RichArticleEditor = lazy(() =>
  import("./RichArticleEditor").then((m) => ({ default: m.RichArticleEditor })),
);

/** External prefill for a new article (e.g. AI output handed to the editor). */
export interface ArticleSeed {
  title?: string;
  content?: string;
  summary?: string;
  image?: string;
  /** Comma-separated topics. */
  tags?: string;
}

interface ArticleEditorProps {
  mode: "new" | "edit";
  initial?: LongFormArticle;
  initialVisibility?: ArticleVisibility;
  initialSpaceId?: string;
  initialChannelId?: string;
  /** Prefill a NEW article (takes precedence over any saved local draft). */
  seed?: ArticleSeed;
  /** Resume a specific device-local draft record (from the Drafts list). */
  resumeDraftId?: string;
  /** Called with the published article's naddr so the route can open it. */
  onPublished: (naddr: string) => void;
  onCancel: () => void;
}

type ViewMode = "rich" | "markdown" | "preview";

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}

export function ArticleEditor({
  mode,
  initial,
  initialVisibility,
  initialSpaceId,
  initialChannelId,
  seed,
  resumeDraftId,
  onPublished,
  onCancel,
}: ArticleEditorProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);

  // Each "Write article" session owns one device-local draft record. Resuming
  // from the Drafts list reuses that record's id; a fresh write mints a new one.
  // AI seeds and edits don't autosave (they'd clobber an unrelated draft), so
  // their id is never persisted to.
  const ownsDraft = mode === "new" && !seed;
  const activeDraftId = useMemo(
    () => resumeDraftId || nanoid(),
    [resumeDraftId],
  );

  // Starting form state. Edit → from the article. Seed (AI) → from the seed.
  // New → empty, with publish context (visibility/space/channel) taken from how
  // the editor was launched. A resumed draft hydrates asynchronously below.
  const start = useMemo<ArticleDraftFields>(() => {
    if (mode === "edit" && initial) {
      return {
        title: initial.title === "Untitled" ? "" : initial.title,
        summary: initial.summary ?? "",
        image: initial.image ?? "",
        tags: initial.hashtags.join(", "),
        content: initial.content,
        visibility: initialVisibility ?? "public",
        spaceId: initialSpaceId ?? "",
        channelId: initialChannelId ?? "",
      };
    }
    if (seed) {
      return {
        title: seed.title ?? "",
        summary: seed.summary ?? "",
        image: seed.image ?? "",
        tags: seed.tags ?? "",
        content: seed.content ?? "",
        visibility: initialSpaceId ? "space" : "public",
        spaceId: initialSpaceId ?? "",
        channelId: initialChannelId ?? "",
      };
    }
    return {
      title: "",
      summary: "",
      image: "",
      tags: "",
      content: "",
      visibility: initialSpaceId ? "space" : "public",
      spaceId: initialSpaceId ?? "",
      channelId: initialChannelId ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [title, setTitle] = useState(start.title);
  const [summary, setSummary] = useState(start.summary);
  const [image, setImage] = useState(start.image);
  const [tags, setTags] = useState(start.tags);
  const [content, setContent] = useState(start.content);
  const [visibility, setVisibility] = useState<ArticleVisibility>(start.visibility);
  const [spaceId, setSpaceId] = useState(start.spaceId);
  const [channelId, setChannelId] = useState(start.channelId);

  // WYSIWYG by default — the friendly, no-markdown surface.
  const [view, setView] = useState<ViewMode>("rich");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A resumed draft loads from IndexedDB after mount; until then autosave is held
  // off so a debounced empty save can't overwrite the record we're loading.
  const [hydrated, setHydrated] = useState(!resumeDraftId);

  useEffect(() => {
    if (!resumeDraftId) return;
    let cancelled = false;
    void getDraft(resumeDraftId).then((rec) => {
      if (cancelled) return;
      if (rec) {
        setTitle(rec.title);
        setSummary(rec.summary);
        setImage(rec.image);
        setTags(rec.tags);
        setContent(rec.content);
        setVisibility(rec.visibility);
        setSpaceId(rec.spaceId);
        setChannelId(rec.channelId);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [resumeDraftId]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, content, 100000);
  useMarkdownShortcuts({ textareaRef, value: content, setValue: setContent });

  const draftFields: ArticleDraftFields = {
    title, summary, image, tags, content, visibility, spaceId, channelId,
  };
  useArticleDraftAutosave({
    pubkey,
    draftId: activeDraftId,
    fields: draftFields,
    enabled: ownsDraft && hydrated && !publishing,
  });

  const discardDraft = useCallback(() => {
    if (ownsDraft) void deleteDraft(activeDraftId);
    setTitle("");
    setSummary("");
    setImage("");
    setTags("");
    setContent("");
    onCancel();
  }, [ownsDraft, activeDraftId, onCancel]);

  // Image paste for the Markdown source textarea (Rich mode handles its own).
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.items)
        .filter((i) => i.kind === "file")
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      const img = files.find((f) => f.type.startsWith("image/"));
      if (!img) return;
      e.preventDefault();
      try {
        const res = await blossomUpload(img);
        const ta = textareaRef.current;
        const cur = ta?.value ?? content;
        const pos = ta ? ta.selectionStart : cur.length;
        const before = cur.slice(0, pos);
        const after = cur.slice(pos);
        const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
        setContent(`${before}${lead}![](${res.url})\n${after}`);
      } catch {
        setError("Couldn't upload pasted image");
      }
    },
    [content],
  );

  const handlePublish = useCallback(async () => {
    if (!pubkey) {
      setError("You're not logged in");
      return;
    }
    if (!title.trim()) {
      setError("Add a title before publishing");
      return;
    }
    if (!content.trim()) {
      setError("Write something before publishing");
      return;
    }

    let targetRelays: string[] | undefined;
    let spaceTag: string | undefined;
    let channelTag: string | undefined;

    if (visibility === "space") {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) {
        setError("Choose a space for this article");
        return;
      }
      // Never silently fall back to all relays — that would leak an "exclusive" article.
      if (!space.hostRelay) {
        setError("This space has no relay to publish to");
        return;
      }
      targetRelays = [space.hostRelay];
      spaceTag = space.id;
      channelTag = channelId || undefined;
    }

    setPublishing(true);
    setError(null);
    try {
      const unsigned = buildArticle(pubkey, {
        content: content.trim(),
        title: title.trim(),
        summary: summary.trim() || undefined,
        image: image.trim() || undefined,
        hashtags: parseTags(tags),
        slug: mode === "edit" ? initial?.dTag : undefined,
        publishedAt: mode === "edit" ? initial?.publishedAt : undefined,
        spaceId: spaceTag,
        channelId: channelTag,
      });
      const signed = await signAndPublish(unsigned, targetRelays);
      if (ownsDraft) void deleteDraft(activeDraftId);
      const d = signed.tags.find((t) => t[0] === "d")?.[1] ?? "";
      const naddr = nip19.naddrEncode({
        kind: 30023,
        pubkey,
        identifier: d,
        relays: targetRelays ?? [],
      });
      onPublished(naddr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish article");
    } finally {
      setPublishing(false);
    }
  }, [
    pubkey, title, content, summary, image, tags, visibility, spaceId, channelId,
    spaces, mode, initial, onPublished, ownsDraft, activeDraftId,
  ]);

  const canPublish = title.trim().length > 0 && content.trim().length > 0 && !publishing;

  const viewButtons: { id: ViewMode; icon: typeof Eye; title: string }[] = [
    { id: "rich", icon: Pilcrow, title: "Rich text" },
    { id: "markdown", icon: Code, title: "Markdown" },
    { id: "preview", icon: Eye, title: "Preview" },
  ];

  const tagChips = useMemo(() => parseTags(tags), [tags]);
  // Offer a discard only once there's saved work worth throwing away.
  const showDiscard = ownsDraft && (title.trim().length > 0 || content.trim().length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-sm font-semibold text-heading">
          {mode === "edit" ? "Edit article" : "New article"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {showDiscard && (
            <button
              onClick={discardDraft}
              className="rounded-lg px-2.5 py-1.5 text-sm text-soft transition-colors hover:bg-surface-hover hover:text-heading"
            >
              Discard
            </button>
          )}
          <div className="flex items-center rounded-lg border border-border p-0.5">
            {viewButtons.map((b) => {
              const Icon = b.icon;
              return (
                <button
                  key={b.id}
                  onClick={() => setView(b.id)}
                  title={b.title}
                  className={`rounded-md px-2 py-1 transition-colors ${
                    view === b.id ? "bg-primary/20 text-primary" : "text-soft hover:text-heading"
                  }`}
                >
                  <Icon size={15} />
                </button>
              );
            })}
          </div>
          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {publishing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {mode === "edit" ? "Update" : "Publish"}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view !== "preview" ? (
          <div className="mx-auto w-full max-w-3xl px-6 py-8">
            {/* Header: cover, title, summary */}
            <CoverImageField value={image} onChange={setImage} />

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
              className="mt-5 w-full bg-transparent text-4xl font-bold leading-tight text-heading placeholder-muted outline-none"
              autoFocus
            />

            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Add a summary or subtitle…"
              className="mt-2 w-full bg-transparent text-lg text-soft placeholder-muted outline-none"
            />

            {/* Topics + audience share one row (two columns) */}
            <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-soft">Topics</label>
                <TagsInput value={tags} onChange={setTags} />
              </div>
              <ArticleVisibilityPicker
                value={visibility}
                onChange={setVisibility}
                spaceId={spaceId}
                onSpaceIdChange={setSpaceId}
                channelId={channelId}
                onChannelIdChange={setChannelId}
              />
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <hr className="my-5 border-border" />

            {/* Body editor — WYSIWYG (default) or raw Markdown source */}
            {view === "rich" ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-border/60">
                    <Loader2 size={18} className="animate-spin text-muted" />
                  </div>
                }
              >
                <RichArticleEditor
                  value={content}
                  onChange={setContent}
                  placeholder="Write your article — use the toolbar to format, or paste images directly."
                />
              </Suspense>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border/60">
                <ArticleToolbar textareaRef={textareaRef} value={content} setValue={setContent} />
                <textarea
                  ref={textareaRef}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Write your article here in Markdown. You can also paste images directly."
                  spellCheck
                  className="min-h-[360px] w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-heading placeholder-muted outline-none"
                />
              </div>
            )}

            <p className="mt-3 text-[11px] text-muted">
              Drafts save automatically on this device. Find and manage them under Reads on your profile.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl px-8 py-8">
            {image && (
              <img src={image} alt={title} className="mb-6 h-52 w-full rounded-2xl object-cover" />
            )}
            <h1 className="text-4xl font-bold leading-tight text-heading">{title || "Untitled"}</h1>
            {summary && <p className="mt-2 text-lg text-soft">{summary}</p>}
            {tagChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tagChips.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary-soft"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-6">
              {content.trim() ? (
                <ArticleMarkdown content={content} />
              ) : (
                <p className="text-sm text-muted">Your formatted article will appear here.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
