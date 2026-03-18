import { useState, useCallback, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Send, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { useAutoResize } from "@/hooks/useAutoResize";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import type { UploadedAttachment } from "@/hooks/useFileUpload";

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
}: DMInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, value, 150);
  const { inputMarginClass } = usePlaybackBarSpacing();

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const hasContent = value.trim().length > 0;
      const hasDoneAttachments = attachments.some((a) => a.status === "done");

      if ((!hasContent && !hasDoneAttachments) || disabled || isUploading) return;

      let content = value.trim();
      for (const att of attachments) {
        if (att.status === "done" && att.result) {
          if (content.length > 0) content += "\n";
          content += att.result.url;
        }
      }

      onSend(content);
      setValue("");
      onClearAttachments();
    },
    [value, disabled, isUploading, attachments, onSend, onClearAttachments],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
    <form onSubmit={handleSubmit} className={`border-t border-edge p-3 ${inputMarginClass}`}>
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
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none overflow-hidden"
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
