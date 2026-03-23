import { useState, useRef, useCallback, useEffect, lazy, Suspense, type FormEvent, type KeyboardEvent } from "react";
import { Send, Paperclip, Check, Smile } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Button } from "../../components/ui/Button";
import { MentionAutocomplete } from "../../components/content/MentionAutocomplete";
import { EmojiAutocomplete } from "../../components/content/EmojiAutocomplete";
import { FormattingToolbar } from "../../components/content/FormattingToolbar";
import { AttachmentPreview } from "../../components/chat/AttachmentPreview";
import { GifPreview } from "../../components/chat/GifPreview";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useMarkdownShortcuts } from "../../hooks/useMarkdownShortcuts";
import { usePlaybackBarSpacing } from "../../hooks/usePlaybackBarSpacing";
import { registerGifShare } from "../../lib/api/gif";
import type { UploadedAttachment } from "../../hooks/useFileUpload";
import type { AttachmentMeta } from "../../lib/nostr/eventBuilder";
import type { NostrEvent } from "../../types/nostr";
import type { GifItem } from "../../types/emoji";
import type { EmojiSelectResult } from "../../components/chat/EmojiPicker";

const LazyGifPicker = lazy(() =>
  import("../../components/chat/GifPicker").then((m) => ({ default: m.GifPicker })),
);
const LazyEmojiPicker = lazy(() =>
  import("../../components/chat/EmojiPicker").then((m) => ({ default: m.EmojiPicker })),
);

interface ChatInputProps {
  onSend: (content: string, mentionPubkeys: string[], attachments?: AttachmentMeta[], emojiTags?: string[][]) => void;
  disabled?: boolean;
  /** Space member pubkeys — used to scope @-mention autocomplete */
  memberPubkeys?: string[];
  /** Current space ID for space-scoped custom emojis */
  spaceId?: string | null;
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
  /** Edit mode: the message being edited + its current display content */
  editingMessage?: { event: NostrEvent; displayContent: string } | null;
  onEditSubmit?: (originalEvent: NostrEvent, newContent: string) => void;
  onEditCancel?: () => void;
  /** Permission flags — when false, the corresponding UI element is hidden */
  canAttachFiles?: boolean;
  canEmbedLinks?: boolean;
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

export function ChatInput({
  onSend,
  disabled,
  memberPubkeys,
  spaceId,
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
  canAttachFiles = true,
  canEmbedLinks = true,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const isEditMode = !!editingMessage;

  // Pre-fill input when entering edit mode, clear when leaving
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.displayContent);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      setValue("");
    }
  }, [editingMessage]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingGif, setPendingGif] = useState<GifItem | null>(null);
  // Map display tokens to pubkeys: "Alice" → hex pubkey
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  // Map custom emoji shortcodes to URLs for NIP-30 tags
  const customEmojiMapRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, value, 150);
  useMarkdownShortcuts({ textareaRef, value, setValue });
  const { inputMarginClass } = usePlaybackBarSpacing();

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

      // Find the :query pattern and replace it
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

      // Register share for API TOS compliance
      registerGifShare(gif.id).catch(() => {});

      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hasContent = value.trim().length > 0;

    // Edit mode: submit edit
    if (isEditMode && editingMessage && onEditSubmit) {
      if (!hasContent) return;
      onEditSubmit(editingMessage.event, value.trim());
      setValue("");
      return;
    }

    const hasDoneAttachments = attachments.some((a) => a.status === "done");

    if ((!hasContent && !hasDoneAttachments && !pendingGif) || disabled || isUploading) return;

    let content = value.trim();
    const mentionPubkeys: string[] = [];

    for (const [displayName, pubkey] of mentionMapRef.current) {
      const token = `@${displayName}`;
      if (content.includes(token)) {
        const npub = npubEncode(pubkey);
        content = content.replaceAll(token, `nostr:${npub}`);
        mentionPubkeys.push(pubkey);
      }
    }

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

    onSend(
      content,
      mentionPubkeys,
      attachmentMetas.length > 0 ? attachmentMetas : undefined,
      emojiTags.length > 0 ? emojiTags : undefined,
    );
    setValue("");
    setMentionQuery(null);
    setEmojiQuery(null);
    setPendingGif(null);
    mentionMapRef.current.clear();
    customEmojiMapRef.current.clear();
    onClearAttachments();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    <form
      onSubmit={handleSubmit}
      className={`relative border-t border-edge p-3 ${inputMarginClass}`}
    >
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          onSelect={handleSelect}
          onClose={() => setMentionQuery(null)}
          scopedPubkeys={memberPubkeys}
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
        <Suspense fallback={<div className="absolute bottom-full left-0 mb-2 w-[360px] h-[420px] rounded-xl border border-edge bg-panel flex items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" /></div>}>
          <LazyGifPicker
            onSelect={handleGifSelect}
            onClose={() => setShowGifPicker(false)}
          />
        </Suspense>
      )}

      {/* Emoji Picker */}
      {showEmojiPicker && (
        <Suspense fallback={<div className="absolute bottom-full left-0 mb-2 w-[352px] h-[435px] rounded-xl border border-edge bg-panel flex items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" /></div>}>
          <LazyEmojiPicker
            spaceId={spaceId}
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

      <div className="rounded-xl bg-field ring-1 ring-edge">
        <FormattingToolbar textareaRef={textareaRef} value={value} setValue={setValue} />
        <div className="flex items-end gap-2 px-3 py-2">
          {canAttachFiles && (
            <button
              type="button"
              onClick={onOpenFilePicker}
              disabled={disabled}
              className="flex-shrink-0 rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors disabled:opacity-50"
              title="Attach file"
            >
              <Paperclip size={18} />
            </button>
          )}

          {canEmbedLinks && (
            <button
              type="button"
              onClick={() => {
                setShowGifPicker((prev) => !prev);
                setShowEmojiPicker(false);
              }}
              disabled={disabled}
              className={`flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                showGifPicker
                  ? "bg-pulse/20 text-pulse"
                  : "text-muted hover:text-heading hover:bg-surface-hover"
              }`}
              title="Search GIFs"
            >
              GIF
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowEmojiPicker((prev) => !prev);
              setShowGifPicker(false);
            }}
            disabled={disabled}
            className={`flex-shrink-0 rounded-lg p-1 transition-colors disabled:opacity-50 ${
              showEmojiPicker
                ? "bg-pulse/20 text-pulse"
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
            placeholder="Send a message..."
            disabled={disabled}
            rows={1}
            spellCheck
            autoCorrect="on"
            autoCapitalize="sentences"
            className="flex-1 resize-none overflow-hidden bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none focus:ring-pulse/30 focus:shadow-[0_0_12px_rgba(139,92,246,0.1)]"
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
