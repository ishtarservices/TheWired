import { useState, useRef, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { Send, Paperclip } from "lucide-react";
import { npubEncode } from "nostr-tools/nip19";
import { Button } from "../../components/ui/Button";
import { MentionAutocomplete } from "../../components/content/MentionAutocomplete";
import { AttachmentPreview } from "../../components/chat/AttachmentPreview";
import { useAutoResize } from "../../hooks/useAutoResize";
import type { UploadedAttachment } from "../../hooks/useFileUpload";
import type { AttachmentMeta } from "../../lib/nostr/eventBuilder";

interface ChatInputProps {
  onSend: (content: string, mentionPubkeys: string[], attachments?: AttachmentMeta[]) => void;
  disabled?: boolean;
  /** Space member pubkeys — used to scope @-mention autocomplete */
  memberPubkeys?: string[];
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
}

/** Match @query at cursor position — preceded by start-of-string or whitespace */
function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

export function ChatInput({
  onSend,
  disabled,
  memberPubkeys,
  attachments,
  onRemoveAttachment,
  onClearAttachments,
  onOpenFilePicker,
  onAddFiles,
  fileInputRef,
  onFileInputChange,
  isUploading,
  hasAttachments,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // Map display tokens to pubkeys: "Alice" → hex pubkey
  const mentionMapRef = useRef<Map<string, string>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, value, 150);

  const updateMentionState = useCallback((val: string, cursor: number) => {
    const query = detectMentionQuery(val, cursor);
    setMentionQuery(query);
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const hasContent = value.trim().length > 0;
    const hasDoneAttachments = attachments.some((a) => a.status === "done");

    if ((!hasContent && !hasDoneAttachments) || disabled || isUploading) return;

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

    onSend(content, mentionPubkeys, attachmentMetas.length > 0 ? attachmentMetas : undefined);
    setValue("");
    setMentionQuery(null);
    mentionMapRef.current.clear();
    onClearAttachments();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        return;
      }
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
      className="relative border-t border-edge p-3"
    >
      {mentionQuery !== null && (
        <MentionAutocomplete
          query={mentionQuery}
          onSelect={handleSelect}
          onClose={() => setMentionQuery(null)}
          scopedPubkeys={memberPubkeys}
        />
      )}

      {/* Attachment previews */}
      <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} />

      <div className="flex items-end gap-2 rounded-xl bg-field px-3 py-2 ring-1 ring-edge">
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
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none overflow-hidden bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none focus:ring-pulse/30 focus:shadow-[0_0_12px_rgba(139,92,246,0.1)]"
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={(!value.trim() && !hasAttachments) || disabled || isUploading}
        >
          <Send size={16} />
        </Button>
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
