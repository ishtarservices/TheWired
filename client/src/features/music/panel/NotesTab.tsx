import { useState, useRef, useCallback, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Lock, Globe, Users, Feather, Loader2, Paperclip, Smile } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeAnnotation } from "@/store/slices/musicSlice";
import { AnnotationCard } from "../AnnotationCard";
import { buildAnnotationEvent } from "../musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { buildDeletionEvent } from "@/lib/nostr/eventBuilder";
import { useAnnotations } from "../useAnnotations";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useFileUpload } from "@/hooks/useFileUpload";
import { registerGifShare } from "@/lib/api/gif";
import { EmojiAutocomplete } from "@/components/content/EmojiAutocomplete";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { GifPreview } from "@/components/chat/GifPreview";
import type { AnnotationLabel, MusicAnnotation } from "@/types/music";
import type { GifItem } from "@/types/emoji";
import type { EmojiSelectResult } from "@/components/chat/EmojiPicker";

const LazyGifPicker = lazy(() =>
  import("@/components/chat/GifPicker").then((m) => ({ default: m.GifPicker })),
);
const LazyEmojiPicker = lazy(() =>
  import("@/components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);

const LABELS: { value: AnnotationLabel; display: string }[] = [
  { value: "story", display: "Story" },
  { value: "credits", display: "Credits" },
  { value: "thanks", display: "Thanks" },
  { value: "process", display: "Process" },
  { value: "lyrics", display: "Lyrics" },
];

type VisibilityTier = "public" | "space" | "private";

function detectEmojiQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
  return match ? match[2] : null;
}

interface NotesTabProps {
  targetRef: string;
  targetName: string;
  ownerPubkey: string;
}

export function NotesTab({ targetRef, targetName, ownerPubkey }: NotesTabProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const spaces = useAppSelector((s) => s.spaces.list);
  const { annotations: visible, loading } = useAnnotations(targetRef);

  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState("");
  const [label, setLabel] = useState<AnnotationLabel | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [visibility, setVisibility] = useState<VisibilityTier>("public");
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rich composer state
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
  const customEmojiMapRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    attachments,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handleFileInputChange,
    fileInputRef,
    isUploading,
    hasAttachments,
    addFiles,
  } = useFileUpload();

  useAutoResize(textareaRef, content, 120);

  const artistNotes = visible.filter((a) => a.authorPubkey === ownerPubkey);
  const communityNotes = visible.filter((a) => a.authorPubkey !== ownerPubkey);

  const communityLimit = expanded ? communityNotes.length : 3;
  const displayedCommunity = communityNotes.slice(0, communityLimit);
  const hasMoreCommunity = communityNotes.length > communityLimit;

  const updateEmojiAutocomplete = useCallback((val: string, cursor: number) => {
    setEmojiQuery(detectEmojiQuery(val, cursor));
  }, []);

  const handleEmojiAutocompleteSelect = useCallback(
    (shortcode: string, url: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = content.slice(0, cursor);
      const after = content.slice(cursor);
      const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
      if (!match) return;
      const prefix = before.slice(0, match.index! + match[1].length);
      const token = `:${shortcode}: `;
      const newValue = `${prefix}${token}${after}`;
      customEmojiMapRef.current.set(shortcode, url);
      setContent(newValue);
      setEmojiQuery(null);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + token.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [content],
  );

  const handleEmojiPickerSelect = useCallback(
    (emoji: EmojiSelectResult) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = content.slice(0, cursor);
      const after = content.slice(cursor);
      let insertion: string;
      if (emoji.isCustom && emoji.shortcode && emoji.src) {
        insertion = `:${emoji.shortcode}: `;
        customEmojiMapRef.current.set(emoji.shortcode, emoji.src);
      } else if (emoji.native) {
        insertion = `${emoji.native} `;
      } else {
        return;
      }
      const newValue = `${before}${insertion}${after}`;
      setContent(newValue);
      setShowEmojiPicker(false);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = before.length + insertion.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [content],
  );

  const handleGifSelect = useCallback((gif: GifItem) => {
    setPendingGif(gif);
    setShowGifPicker(false);
    registerGifShare(gif.id).catch(() => {});
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleDelete = async (ann: MusicAnnotation) => {
    if (!pubkey) return;
    dispatch(removeAnnotation({
      targetRef: ann.targetRef,
      addressableId: ann.addressableId,
    }));
    const unsigned = buildDeletionEvent(pubkey, {
      addressableIds: [ann.addressableId],
    });
    try {
      await signAndPublish(unsigned);
    } catch {
      // Best-effort
    }
  };

  const handleTogglePin = async (ann: MusicAnnotation) => {
    if (!pubkey) return;
    const annId = ann.addressableId.split(":").slice(2).join(":");
    const rawId = annId.startsWith("ann:") ? annId.slice(4) : annId;
    const unsigned = buildAnnotationEvent(pubkey, {
      annotationId: rawId,
      targetRef: ann.targetRef,
      content: ann.content,
      label: ann.label,
      customLabel: ann.customLabel,
      isPrivate: ann.isPrivate,
      isPinned: !ann.isPinned,
      spaceId: ann.spaceId,
    });
    try {
      await signAndPublish(unsigned);
    } catch {
      // Best-effort
    }
  };

  const handlePost = async () => {
    if (!pubkey || !content.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const annotationId = crypto.randomUUID().slice(0, 12);

      // Build final content with attachments and GIF
      let finalContent = content.trim();

      for (const att of attachments) {
        if (att.status === "done" && att.result) {
          if (finalContent.length > 0) finalContent += "\n";
          finalContent += att.result.url;
        }
      }

      if (pendingGif) {
        if (finalContent.length > 0) finalContent += "\n";
        finalContent += pendingGif.url;
      }

      const unsigned = buildAnnotationEvent(pubkey, {
        annotationId,
        targetRef,
        content: finalContent,
        label: label ?? undefined,
        customLabel: label === "custom" ? customLabel.trim() || undefined : undefined,
        isPrivate: visibility === "private",
        spaceId: visibility === "space" && selectedSpaceId ? selectedSpaceId : undefined,
      });

      if (visibility === "private") {
        await signAndSaveLocally(unsigned);
      } else {
        await signAndPublish(unsigned);
      }

      // Reset all state
      setContent("");
      setLabel(null);
      setCustomLabel("");
      setVisibility("public");
      setSelectedSpaceId(null);
      setPendingGif(null);
      setShowGifPicker(false);
      setShowEmojiPicker(false);
      setEmojiQuery(null);
      customEmojiMapRef.current.clear();
      clearAttachments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLabel = (l: AnnotationLabel) => {
    setLabel((prev) => (prev === l ? null : l));
  };

  const cycleVisibility = () => {
    setVisibility((v) => {
      if (v === "public") return spaces.length > 0 ? "space" : "private";
      if (v === "space") return "private";
      return "public";
    });
  };

  const isOwner = pubkey === ownerPubkey;

  const VisibilityIcon = visibility === "private" ? Lock : visibility === "space" ? Users : Globe;
  const visibilityLabel = visibility === "private" ? "Private" : visibility === "space" ? "Space" : "Public";
  const visibilityStyles = visibility === "private"
    ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
    : visibility === "space"
      ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20"
      : "bg-surface/60 text-muted hover:text-soft";

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Loading state */}
      {loading && visible.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="animate-spin text-muted" />
        </div>
      )}

      {/* ── Artist Notes ── */}
      {artistNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted/60 px-1">
            Artist Notes
          </p>
          <div className="space-y-2">
            {artistNotes.map((ann) => (
              <AnnotationCard
                key={ann.addressableId}
                annotation={ann}
                isArtistNote
                onDelete={
                  ann.authorPubkey === pubkey || isOwner
                    ? () => handleDelete(ann)
                    : undefined
                }
                onTogglePin={
                  isOwner && ann.authorPubkey === pubkey
                    ? () => handleTogglePin(ann)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Community Notes ── */}
      {communityNotes.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted/60 px-1">
            Community Notes
          </p>
          <div className="space-y-2">
            {displayedCommunity.map((ann) => (
              <AnnotationCard
                key={ann.addressableId}
                annotation={ann}
                isArtistNote={false}
                onDelete={
                  ann.authorPubkey === pubkey || isOwner
                    ? () => handleDelete(ann)
                    : undefined
                }
              />
            ))}
          </div>
          {hasMoreCommunity && (
            <button
              onClick={() => setExpanded(true)}
              className="mt-2 w-full rounded-lg py-1.5 text-center text-[11px] text-muted transition-colors hover:text-soft"
            >
              Show {communityNotes.length - communityLimit} more
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/40 px-4 py-6 text-center">
          <Feather size={20} className="mx-auto mb-2 text-muted/40" />
          <p className="text-xs text-muted">No notes yet</p>
        </div>
      )}

      {/* ── Rich Inline Composer ── */}
      {pubkey && (
        <div className="relative sticky bottom-0 border-t border-border/40 bg-card/80 backdrop-blur-sm pt-3 -mx-3 px-3 pb-1">
          {/* Emoji autocomplete */}
          {emojiQuery !== null && (
            <div className="absolute bottom-full left-3 z-50 mb-1">
              <EmojiAutocomplete
                query={emojiQuery}
                onSelect={handleEmojiAutocompleteSelect}
                onClose={() => setEmojiQuery(null)}
              />
            </div>
          )}

          {/* GIF Picker — portaled to escape overflow clipping */}
          {showGifPicker && createPortal(
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setShowGifPicker(false)}
            >
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                onClick={(e) => e.stopPropagation()}
              >
                <Suspense
                  fallback={
                    <div className="w-[360px] h-[420px] rounded-xl border border-border bg-panel flex items-center justify-center">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  }
                >
                  <LazyGifPicker
                    onSelect={handleGifSelect}
                    onClose={() => setShowGifPicker(false)}
                  />
                </Suspense>
              </div>
            </div>,
            document.body,
          )}

          {/* Emoji Picker — portaled to escape overflow clipping */}
          {showEmojiPicker && createPortal(
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setShowEmojiPicker(false)}
            >
              <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                onClick={(e) => e.stopPropagation()}
              >
                <Suspense
                  fallback={
                    <div className="w-[352px] h-[435px] rounded-xl border border-border bg-panel flex items-center justify-center">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  }
                >
                  <LazyEmojiPicker
                    onEmojiSelect={handleEmojiPickerSelect}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                </Suspense>
              </div>
            </div>,
            document.body,
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              updateEmojiAutocomplete(e.target.value, e.target.selectionStart);
            }}
            onKeyUp={(e) => updateEmojiAutocomplete(content, e.currentTarget.selectionStart)}
            onClick={(e) => updateEmojiAutocomplete(content, e.currentTarget.selectionStart)}
            onPaste={handlePaste}
            rows={2}
            className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm text-heading placeholder-muted/50 outline-none transition-colors focus:border-primary/30 resize-none leading-relaxed"
            placeholder={`Add a note about "${targetName}"...`}
          />

          {/* Attachment previews */}
          {hasAttachments && (
            <div className="mt-1">
              <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
            </div>
          )}

          {/* GIF preview */}
          {pendingGif && (
            <div className="mt-1">
              <GifPreview gif={pendingGif} onRemove={() => setPendingGif(null)} />
            </div>
          )}

          {/* Media buttons row */}
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={openFilePicker}
              className="rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
              title="Attach file"
            >
              <Paperclip size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                setShowGifPicker((prev) => !prev);
                setShowEmojiPicker(false);
              }}
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors ${
                showGifPicker
                  ? "bg-primary/20 text-primary"
                  : "text-muted hover:text-heading hover:bg-surface-hover"
              }`}
              title="Search GIFs"
            >
              GIF
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEmojiPicker((prev) => !prev);
                setShowGifPicker(false);
              }}
              className={`rounded-lg p-1 transition-colors ${
                showEmojiPicker
                  ? "bg-primary/20 text-primary"
                  : "text-muted hover:text-heading hover:bg-surface-hover"
              }`}
              title="Emoji"
            >
              <Smile size={14} />
            </button>
          </div>

          {/* Labels */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {LABELS.map((l) => (
              <button
                key={l.value}
                onClick={() => toggleLabel(l.value)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                  label === l.value
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-surface/60 text-muted hover:text-soft hover:bg-surface"
                }`}
              >
                {l.display}
              </button>
            ))}
            <button
              onClick={() => toggleLabel("custom")}
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${
                label === "custom"
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "bg-surface/60 text-muted hover:text-soft hover:bg-surface"
              }`}
            >
              +
            </button>
          </div>

          {label === "custom" && (
            <input
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Label name..."
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-xs text-heading placeholder-muted/50 outline-none focus:border-primary/30"
            />
          )}

          {/* Space picker when space visibility is selected */}
          {visibility === "space" && spaces.length > 0 && (
            <select
              value={selectedSpaceId ?? ""}
              onChange={(e) => setSelectedSpaceId(e.target.value || null)}
              className="mt-1.5 w-full rounded-lg border border-border/50 bg-transparent px-2.5 py-1 text-xs text-heading outline-none focus:border-primary/30"
            >
              <option value="">Select space...</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name || s.id}</option>
              ))}
            </select>
          )}

          {/* Footer */}
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={cycleVisibility}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all ${visibilityStyles}`}
            >
              <VisibilityIcon size={10} />
              {visibilityLabel}
            </button>
            <button
              onClick={handlePost}
              disabled={submitting || (!content.trim() && !hasAttachments && !pendingGif) || (visibility === "space" && !selectedSpaceId) || isUploading}
              className="rounded-full bg-gradient-to-r from-primary to-primary-soft px-4 py-1 text-[11px] font-medium text-white transition-all hover:opacity-90 press-effect disabled:opacity-40"
            >
              {submitting ? "Posting..." : "Post"}
            </button>
          </div>
          {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf"
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>
      )}
    </div>
  );
}
