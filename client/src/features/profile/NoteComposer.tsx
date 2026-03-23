import { useState, useRef, useCallback, lazy, Suspense } from "react";
import { Send, Paperclip, Smile, Loader2, ImageIcon } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Avatar } from "@/components/ui/Avatar";
import { MentionAutocomplete } from "@/components/content/MentionAutocomplete";
import { EmojiAutocomplete } from "@/components/content/EmojiAutocomplete";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { GifPreview } from "@/components/chat/GifPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useAppSelector } from "@/store/hooks";
import { buildRootNote } from "@/lib/nostr/eventBuilder";
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

/** Match @query at cursor position */
function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

/** Match :query at cursor position for emoji autocomplete */
function detectEmojiQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
  return match ? match[2] : null;
}

export function NoteComposer() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const profile = useAppSelector((s) => s.identity.profile);
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
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

  useAutoResize(textareaRef, value, 200);

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

  const handleSubmit = useCallback(async () => {
    if (!pubkey) return;
    const hasContent = value.trim().length > 0;
    const hasDoneAttachments = attachments.some((a) => a.status === "done");
    if (!hasContent && !hasDoneAttachments && !pendingGif) return;
    if (publishing || isUploading) return;

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
          if (content.length > 0) content += "\n";
          content += att.result.url;
        }
      }

      // Append GIF URL
      if (pendingGif) {
        if (content.length > 0) content += "\n";
        content += pendingGif.url;
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

      // Reset state
      setValue("");
      setMentionQuery(null);
      setEmojiQuery(null);
      setPendingGif(null);
      setShowGifPicker(false);
      setShowEmojiPicker(false);
      mentionMapRef.current.clear();
      customEmojiMapRef.current.clear();
      clearAttachments();
      setExpanded(false);
    } finally {
      setPublishing(false);
    }
  }, [pubkey, value, attachments, pendingGif, publishing, isUploading, clearAttachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Let autocomplete handle its own keys
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
      } else if (!value.trim() && !hasAttachments && !pendingGif) {
        setExpanded(false);
      }
      return;
    }

    // Ctrl/Cmd+Enter to post
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!pubkey) return null;

  const displayName = profile?.display_name || profile?.name || pubkey.slice(0, 12);
  const hasContent = value.trim().length > 0 || hasAttachments || !!pendingGif;

  // Collapsed state
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
        className="mx-6 mt-4 flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3 text-left transition-colors hover:border-edge-light hover:bg-surface-hover"
      >
        <Avatar
          src={profile?.picture}
          alt={displayName}
          size="sm"
          className="h-8 w-8 shrink-0"
        />
        <span className="text-sm text-muted">What's on your mind?</span>
      </button>
    );
  }

  // Expanded state
  return (
    <div className="relative mx-6 mt-4 rounded-xl border border-edge bg-surface">
      {/* Autocomplete popups */}
      <div className="relative">
        {mentionQuery !== null && (
          <div className="absolute bottom-full left-3 z-50">
            <MentionAutocomplete
              query={mentionQuery}
              onSelect={handleMentionSelect}
              onClose={() => setMentionQuery(null)}
            />
          </div>
        )}
        {emojiQuery !== null && (
          <div className="absolute bottom-full left-3 z-50">
            <EmojiAutocomplete
              query={emojiQuery}
              onSelect={handleEmojiAutocompleteSelect}
              onClose={() => setEmojiQuery(null)}
            />
          </div>
        )}
      </div>

      {/* GIF Picker */}
      {showGifPicker && (
        <div className="absolute bottom-full left-0 z-50 mb-2">
          <Suspense
            fallback={
              <div className="w-[360px] h-[420px] rounded-xl border border-edge bg-panel flex items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
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
        <div className="absolute bottom-full left-0 z-50 mb-2">
          <Suspense
            fallback={
              <div className="w-[352px] h-[435px] rounded-xl border border-edge bg-panel flex items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
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

      {/* Author header */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-1">
        <Avatar
          src={profile?.picture}
          alt={displayName}
          size="sm"
          className="h-8 w-8 shrink-0"
        />
        <span className="text-sm font-medium text-heading">{displayName}</span>
      </div>

      {/* Textarea */}
      <div className="px-4 py-2">
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
          placeholder="What's on your mind?"
          rows={3}
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          className="w-full resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none"
        />
      </div>

      {/* Attachment previews */}
      <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

      {/* GIF preview */}
      {pendingGif && (
        <GifPreview gif={pendingGif} onRemove={() => setPendingGif(null)} />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-t border-edge px-3 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openFilePicker}
            className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>
          <button
            type="button"
            onClick={openFilePicker}
            className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
            title="Add image"
          >
            <ImageIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setShowGifPicker((prev) => !prev);
              setShowEmojiPicker(false);
            }}
            className={`rounded-md px-1.5 py-1 text-[11px] font-bold transition-colors ${
              showGifPicker
                ? "bg-pulse/20 text-pulse"
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
                ? "bg-pulse/20 text-pulse"
                : "text-muted hover:text-heading hover:bg-surface-hover"
            }`}
            title="Emoji"
          >
            <Smile size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setValue("");
              clearAttachments();
              setPendingGif(null);
              mentionMapRef.current.clear();
              customEmojiMapRef.current.clear();
              setExpanded(false);
            }}
            className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || publishing || isUploading}
            className="flex items-center gap-1.5 rounded-lg bg-pulse/20 px-4 py-1.5 text-sm font-medium text-pulse transition-colors hover:bg-pulse/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {publishing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Post
          </button>
        </div>
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
  );
}
