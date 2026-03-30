import { useState, useRef, useCallback, lazy, Suspense } from "react";
import { X, Paperclip, Smile, Loader2, Send, Repeat2, Disc3 } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Modal } from "@/components/ui/Modal";
import { MentionAutocomplete } from "@/components/content/MentionAutocomplete";
import { EmojiAutocomplete } from "@/components/content/EmojiAutocomplete";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { GifPreview } from "@/components/chat/GifPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useAppSelector } from "@/store/hooks";
import { buildRootNote, buildRepost } from "@/lib/nostr/eventBuilder";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import { signAndPublish } from "@/lib/nostr/publish";
import { registerGifShare } from "@/lib/api/gif";
import type { AttachmentMeta } from "@/lib/nostr/eventBuilder";
import type { GifItem } from "@/types/emoji";
import type { EmojiSelectResult } from "@/components/chat/EmojiPicker";

const LazyGifPicker = lazy(() =>
  import("@/components/chat/GifPicker").then((m) => ({ default: m.GifPicker })),
);
const LazyEmojiPicker = lazy(() =>
  import("@/components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);

export interface MusicPostTarget {
  addressableId: string;
  eventId: string;
  pubkey: string;
  title: string;
  artist: string;
  imageUrl?: string;
  kind: "track" | "album";
}

interface MusicPostModalProps {
  open: boolean;
  onClose: () => void;
  target: MusicPostTarget;
}

function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

function detectEmojiQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
  return match ? match[2] : null;
}

export function MusicPostModal({ open, onClose, target }: MusicPostModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const originalEvent = useAppSelector((s) => s.events.entities[target.eventId]);

  const [value, setValue] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mentionMapRef = useRef<Map<string, string>>(new Map());
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

  useAutoResize(textareaRef, value, 150);

  const updateAutocompleteState = useCallback((val: string, cursor: number) => {
    setMentionQuery(detectMentionQuery(val, cursor));
    setEmojiQuery(detectEmojiQuery(val, cursor));
  }, []);

  const handleMentionSelect = useCallback(
    (pk: string, displayName: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/(^|\s)@\w*$/);
      if (!match) return;
      const prefix = before.slice(0, match.index! + match[1].length);
      const token = `@${displayName}`;
      const newValue = `${prefix}${token} ${after}`;
      mentionMapRef.current.set(displayName, pk);
      setValue(newValue);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + token.length + 1;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleEmojiAutocompleteSelect = useCallback(
    (shortcode: string, url: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
      const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
      if (!match) return;
      const prefix = before.slice(0, match.index! + match[1].length);
      const token = `:${shortcode}: `;
      const newValue = `${prefix}${token}${after}`;
      customEmojiMapRef.current.set(shortcode, url);
      setValue(newValue);
      setEmojiQuery(null);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + token.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleEmojiPickerSelect = useCallback(
    (emoji: EmojiSelectResult) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);
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
      setValue(newValue);
      setShowEmojiPicker(false);
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = before.length + insertion.length;
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
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

  const resetState = () => {
    setValue("");
    setMentionQuery(null);
    setEmojiQuery(null);
    setShowGifPicker(false);
    setShowEmojiPicker(false);
    setPendingGif(null);
    setError(null);
    mentionMapRef.current.clear();
    customEmojiMapRef.current.clear();
    clearAttachments();
  };

  /** Post as kind:1 note with naddr embed */
  const handlePost = useCallback(async () => {
    if (!pubkey) return;
    if (publishing || isUploading) return;
    setError(null);
    setPublishing(true);

    try {
      let content = value.trim();
      const mentionPubkeys: string[] = [];

      // Replace @mentions with nostr: URIs
      for (const [displayName, pk] of mentionMapRef.current) {
        const token = `@${displayName}`;
        if (content.includes(token)) {
          const npub = npubEncode(pk);
          content = content.replaceAll(token, `nostr:${npub}`);
          mentionPubkeys.push(pk);
        }
      }

      // Append naddr reference for the track/album
      const naddr = buildNaddrReference(target.addressableId);
      if (content.length > 0) content += "\n\n";
      content += naddr;

      // Build attachment metas and append URLs
      const attachmentMetas: AttachmentMeta[] = [];
      for (const att of attachments) {
        if (att.status === "done" && att.result) {
          attachmentMetas.push({
            url: att.result.url,
            mimeType: att.result.mimeType,
            sha256: att.result.sha256,
            size: att.result.size,
          });
          content += "\n" + att.result.url;
        }
      }

      // Append GIF URL
      if (pendingGif) {
        content += "\n" + pendingGif.url;
      }

      // Build NIP-30 emoji tags
      const emojiTags: string[][] = [];
      const shortcodeRe = /:([a-zA-Z0-9_]+):/g;
      let m: RegExpExecArray | null;
      while ((m = shortcodeRe.exec(content)) !== null) {
        const url = customEmojiMapRef.current.get(m[1]);
        if (url) {
          emojiTags.push(["emoji", m[1], url]);
        }
      }

      const unsigned = buildRootNote(
        pubkey,
        content,
        mentionPubkeys.length > 0 ? mentionPubkeys : undefined,
        attachmentMetas.length > 0 ? attachmentMetas : undefined,
        emojiTags.length > 0 ? emojiTags : undefined,
      );

      await signAndPublish(unsigned);
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPublishing(false);
    }
  }, [pubkey, value, attachments, pendingGif, publishing, isUploading, target.addressableId, onClose, clearAttachments]);

  /** Simple kind:6 repost of the original event */
  const handleRepost = useCallback(async () => {
    if (!pubkey || !originalEvent) return;
    if (reposting) return;
    setError(null);
    setReposting(true);

    try {
      const unsigned = buildRepost(
        pubkey,
        { id: originalEvent.id, pubkey: originalEvent.pubkey },
        JSON.stringify(originalEvent),
      );
      await signAndPublish(unsigned);
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to repost");
    } finally {
      setReposting(false);
    }
  }, [pubkey, originalEvent, reposting, onClose, clearAttachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null || emojiQuery !== null) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (showGifPicker || showEmojiPicker) {
        setShowGifPicker(false);
        setShowEmojiPicker(false);
      }
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlePost();
    }
  };

  const hasContent = value.trim().length > 0 || hasAttachments || !!pendingGif;
  const kindLabel = target.kind === "album" ? "Album" : "Track";

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-[520px] max-h-[85vh] flex flex-col rounded-2xl border border-border/60 card-glass shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <h2 className="text-sm font-semibold text-heading">Share {kindLabel}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Target preview */}
        <div className="flex items-center gap-3 border-b border-border/30 px-4 py-3">
          {target.imageUrl ? (
            <img
              src={target.imageUrl}
              alt={target.title}
              className="h-12 w-12 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-card">
              <Disc3 size={20} className="text-muted" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-heading">{target.title}</p>
            <p className="truncate text-xs text-soft">{target.artist}</p>
          </div>
          <span className="shrink-0 rounded-full bg-surface/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
            {kindLabel}
          </span>
        </div>

        {/* Composer area */}
        <div className="relative flex-1 overflow-y-auto">
          {/* Autocomplete popups */}
          {mentionQuery !== null && (
            <div className="absolute top-0 left-3 z-50">
              <MentionAutocomplete
                query={mentionQuery}
                onSelect={handleMentionSelect}
                onClose={() => setMentionQuery(null)}
              />
            </div>
          )}
          {emojiQuery !== null && (
            <div className="absolute top-0 left-3 z-50">
              <EmojiAutocomplete
                query={emojiQuery}
                onSelect={handleEmojiAutocompleteSelect}
                onClose={() => setEmojiQuery(null)}
              />
            </div>
          )}

          {/* GIF Picker */}
          {showGifPicker && (
            <div className="absolute top-0 left-0 z-50">
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
          )}

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div className="absolute top-0 left-0 z-50">
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
          )}

          {/* Textarea */}
          <div className="px-4 py-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                updateAutocompleteState(e.target.value, e.target.selectionStart);
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={(e) => updateAutocompleteState(value, e.currentTarget.selectionStart)}
              onClick={(e) => updateAutocompleteState(value, e.currentTarget.selectionStart)}
              onPaste={handlePaste}
              placeholder={`Say something about this ${kindLabel.toLowerCase()}...`}
              rows={3}
              spellCheck
              autoCorrect="on"
              autoCapitalize="sentences"
              className="w-full resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none leading-relaxed"
            />
          </div>

          {/* Attachment previews */}
          {hasAttachments && (
            <div className="px-4">
              <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
            </div>
          )}

          {/* GIF preview */}
          {pendingGif && (
            <div className="px-4">
              <GifPreview gif={pendingGif} onRemove={() => setPendingGif(null)} />
            </div>
          )}
        </div>

        {/* Toolbar + actions */}
        <div className="border-t border-border/40 px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Media buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={openFilePicker}
                className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
                title="Attach file"
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGifPicker((prev) => !prev);
                  setShowEmojiPicker(false);
                }}
                className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold transition-colors ${
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
                className={`rounded-lg p-1.5 transition-colors ${
                  showEmojiPicker
                    ? "bg-primary/20 text-primary"
                    : "text-muted hover:text-heading hover:bg-surface-hover"
                }`}
                title="Emoji"
              >
                <Smile size={16} />
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              {originalEvent && (
                <button
                  type="button"
                  onClick={handleRepost}
                  disabled={reposting}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-soft transition-colors hover:border-border-light hover:text-heading disabled:opacity-40"
                >
                  {reposting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Repeat2 size={13} />
                  )}
                  Repost
                </button>
              )}
              <button
                type="button"
                onClick={handlePost}
                disabled={!hasContent || publishing || isUploading}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary-soft px-4 py-1.5 text-xs font-medium text-white transition-all hover:opacity-90 press-effect disabled:opacity-40"
              >
                {publishing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Send size={13} />
                )}
                Post
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
        </div>

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
    </Modal>
  );
}
