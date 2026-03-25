import { useState, useCallback, useRef, useEffect, lazy, Suspense, type FormEvent, type KeyboardEvent } from "react";
import { Send, Paperclip, Check, Smile } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Button } from "@/components/ui/Button";
import { MentionAutocomplete } from "@/components/content/MentionAutocomplete";
import { EmojiAutocomplete } from "@/components/content/EmojiAutocomplete";
import { FormattingToolbar } from "@/components/content/FormattingToolbar";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { GifPreview } from "@/components/chat/GifPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useMarkdownShortcuts } from "@/hooks/useMarkdownShortcuts";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { registerGifShare } from "@/lib/api/gif";
import type { UploadedAttachment } from "@/hooks/useFileUpload";
import type { DMMessage } from "@/store/slices/dmSlice";
import type { GifItem } from "@/types/emoji";
import type { EmojiSelectResult } from "@/components/chat/EmojiPicker";

const LazyGifPicker = lazy(() =>
  import("@/components/chat/GifPicker").then((m) => ({ default: m.GifPicker })),
);
const LazyEmojiPicker = lazy(() =>
  import("@/components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);

interface DMInputProps {
  onSend: (content: string, emojiTags?: string[][]) => void;
  disabled?: boolean;
  /** File upload state/handlers from parent */
  attachments: UploadedAttachment[];
  onRemoveAttachment: (id: string) => void;
  onClearAttachments: () => void;
  onOpenFilePicker: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading: boolean;
  hasAttachments: boolean;
  /** Edit mode */
  editingMessage?: DMMessage | null;
  onEditSubmit?: (message: DMMessage, newContent: string) => void;
  onEditCancel?: () => void;
}

/** Match @query at cursor position — preceded by start-of-string or whitespace */
function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

/** Match :query at cursor position for emoji autocomplete (2+ chars after :) */
function detectEmojiQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s):([a-zA-Z0-9_]{2,})$/);
  return match ? match[2] : null;
}

export function DMInput({
  onSend,
  disabled,
  attachments,
  onRemoveAttachment,
  onClearAttachments,
  onOpenFilePicker,
  onAddFiles,
  fileInputRef,
  onFileInputChange,
  isUploading,
  hasAttachments,
  editingMessage,
  onEditSubmit,
  onEditCancel,
}: DMInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, value, 150);
  useMarkdownShortcuts({ textareaRef, value, setValue });
  const { inputMarginClass } = usePlaybackBarSpacing();
  const isEditMode = !!editingMessage;

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const customEmojiMapRef = useRef<Map<string, string>>(new Map());

  // Pre-fill input when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.editedContent ?? editingMessage.content);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editingMessage]);

  const updateAutocompleteState = useCallback((val: string, cursor: number) => {
    setMentionQuery(detectMentionQuery(val, cursor));
    setEmojiQuery(detectEmojiQuery(val, cursor));
  }, []);

  const handleSelect = useCallback(
    (pubkey: string, displayName: string) => {
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

      mentionMapRef.current.set(displayName, pubkey);
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

  const handleGifSelect = useCallback(
    (gif: GifItem) => {
      setPendingGif(gif);
      setShowGifPicker(false);

      registerGifShare(gif.id).catch(() => {});
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const hasContent = value.trim().length > 0;

      // Edit mode
      if (isEditMode && editingMessage && onEditSubmit) {
        if (!hasContent) return;
        onEditSubmit(editingMessage, value.trim());
        setValue("");
        return;
      }

      const hasDoneAttachments = attachments.some((a) => a.status === "done");

      if ((!hasContent && !hasDoneAttachments && !pendingGif) || disabled || isUploading) return;

      let content = value.trim();

      // Replace @displayName tokens with nostr:npub format
      for (const [displayName, pubkey] of mentionMapRef.current) {
        const token = `@${displayName}`;
        if (content.includes(token)) {
          const npub = npubEncode(pubkey);
          content = content.replaceAll(token, `nostr:${npub}`);
        }
      }

      for (const att of attachments) {
        if (att.status === "done" && att.result) {
          if (content.length > 0) content += "\n";
          content += att.result.url;
        }
      }

      // Append pending GIF URL
      if (pendingGif) {
        if (content.length > 0) content += "\n";
        content += pendingGif.url;
      }

      // Build NIP-30 emoji tags from custom emojis used in the message
      const emojiTags: string[][] = [];
      const shortcodeRe = /:([a-zA-Z0-9_]+):/g;
      let m: RegExpExecArray | null;
      while ((m = shortcodeRe.exec(content)) !== null) {
        const url = customEmojiMapRef.current.get(m[1]);
        if (url) {
          emojiTags.push(["emoji", m[1], url]);
        }
      }

      onSend(content, emojiTags.length > 0 ? emojiTags : undefined);
      setValue("");
      setMentionQuery(null);
      setEmojiQuery(null);
      setPendingGif(null);
      mentionMapRef.current.clear();
      customEmojiMapRef.current.clear();
      onClearAttachments();
    },
    [value, disabled, isUploading, attachments, onSend, onClearAttachments, isEditMode, editingMessage, onEditSubmit],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let autocompletes handle navigation keys when open
    if (mentionQuery !== null || emojiQuery !== null) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        return;
      }
    }

    if (e.key === "Escape" && isEditMode) {
      e.preventDefault();
      setValue("");
      onEditCancel?.();
      return;
    }

    if (e.key === "Escape" && (showGifPicker || showEmojiPicker)) {
      e.preventDefault();
      setShowGifPicker(false);
      setShowEmojiPicker(false);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

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
        onAddFiles(files);
      }
    },
    [onAddFiles],
  );

  return (
    <form onSubmit={handleSubmit} className={`relative border-t border-border p-3 ${inputMarginClass}`}>
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          onSelect={handleSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}

      {emojiQuery !== null && (
        <EmojiAutocomplete
          query={emojiQuery}
          onSelect={handleEmojiAutocompleteSelect}
          onClose={() => setEmojiQuery(null)}
        />
      )}

      {/* GIF Picker */}
      {showGifPicker && (
        <Suspense fallback={<div className="absolute bottom-full left-0 mb-2 w-[360px] h-[420px] rounded-xl border border-border bg-panel flex items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
          <LazyGifPicker
            onSelect={handleGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        </Suspense>
      )}

      {/* Emoji Picker */}
      {showEmojiPicker && (
        <Suspense fallback={<div className="absolute bottom-full left-0 mb-2 w-[352px] h-[435px] rounded-xl border border-border bg-panel flex items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>}>
          <LazyEmojiPicker
            onEmojiSelect={handleEmojiPickerSelect}
            onClose={() => setShowEmojiPicker(false)}
          />
        </Suspense>
      )}

      {/* Attachment previews */}
      <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />

      {/* GIF preview */}
      {pendingGif && (
        <GifPreview gif={pendingGif} onRemove={() => setPendingGif(null)} />
      )}

      <div className="rounded-xl bg-field ring-1 ring-border">
        <FormattingToolbar textareaRef={textareaRef} value={value} setValue={setValue} />
        <div className="flex items-end gap-2 px-3 py-2">
          <button
            type="button"
            onClick={onOpenFilePicker}
            disabled={disabled}
            className="flex-shrink-0 rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-50"
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowGifPicker((prev) => !prev);
              setShowEmojiPicker(false);
            }}
            disabled={disabled}
            className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
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
            disabled={disabled}
            className={`flex-shrink-0 rounded-lg p-1 transition-colors disabled:opacity-50 ${
              showEmojiPicker
                ? "bg-primary/20 text-primary"
                : "text-muted hover:text-heading hover:bg-surface-hover"
            }`}
            title="Emoji"
          >
            <Smile size={18} />
          </button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              updateAutocompleteState(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => {
              updateAutocompleteState(value, e.currentTarget.selectionStart);
            }}
            onClick={(e) => {
              updateAutocompleteState(value, e.currentTarget.selectionStart);
            }}
            onPaste={handlePaste}
            placeholder={isEditMode ? "Edit message..." : "Send a message..."}
            disabled={disabled}
            rows={1}
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            className="flex-1 resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none overflow-hidden"
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            disabled={(!value.trim() && !hasAttachments && !pendingGif) || disabled || isUploading}
          >
            {isEditMode ? <Check size={16} /> : <Send size={16} />}
          </Button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,application/pdf"
        className="hidden"
        onChange={onFileInputChange}
      />
    </form>
  );
}
