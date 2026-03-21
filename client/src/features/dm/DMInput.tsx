import { useState, useCallback, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { Send, Paperclip, Check } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Button } from "@/components/ui/Button";
import { MentionAutocomplete } from "@/components/content/MentionAutocomplete";
import { FormattingToolbar } from "@/components/content/FormattingToolbar";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { useMarkdownShortcuts } from "@/hooks/useMarkdownShortcuts";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import type { UploadedAttachment } from "@/hooks/useFileUpload";
import type { DMMessage } from "@/store/slices/dmSlice";

interface DMInputProps {
  onSend: (content: string) => void;
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
  const mentionMapRef = useRef<Map<string, string>>(new Map());

  // Pre-fill input when entering edit mode
  useEffect(() => {
    if (editingMessage) {
      setValue(editingMessage.editedContent ?? editingMessage.content);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editingMessage]);

  const updateMentionState = useCallback((val: string, cursor: number) => {
    setMentionQuery(detectMentionQuery(val, cursor));
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

      if ((!hasContent && !hasDoneAttachments) || disabled || isUploading) return;

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

      onSend(content);
      setValue("");
      setMentionQuery(null);
      mentionMapRef.current.clear();
      onClearAttachments();
    },
    [value, disabled, isUploading, attachments, onSend, onClearAttachments, isEditMode, editingMessage, onEditSubmit],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let MentionAutocomplete handle navigation keys when open
    if (mentionQuery !== null) {
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
    <form onSubmit={handleSubmit} className={`relative border-t border-edge p-3 ${inputMarginClass}`}>
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          onSelect={handleSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}

      {/* Attachment previews */}
      <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />

      <div className="rounded-xl bg-field ring-1 ring-edge">
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

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={(e) => {
              updateMentionState(value, e.currentTarget.selectionStart);
            }}
            onClick={(e) => {
              updateMentionState(value, e.currentTarget.selectionStart);
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
            disabled={(!value.trim() && !hasAttachments) || disabled || isUploading}
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
