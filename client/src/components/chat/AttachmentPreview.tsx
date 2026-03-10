import { X, FileText, Music, Film, ImageIcon, AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import type { UploadedAttachment } from "@/hooks/useFileUpload";

interface AttachmentPreviewProps {
  attachments: UploadedAttachment[];
  onRemove: (id: string) => void;
}

function getFileCategory(file: File): "image" | "video" | "audio" | "pdf" | "other" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf") return "pdf";
  return "other";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: UploadedAttachment;
  onRemove: () => void;
}) {
  const category = getFileCategory(attachment.file);
  const isError = attachment.status === "error";
  const isUploading = attachment.status === "uploading";

  return (
    <div
      className={`group/att relative flex-shrink-0 rounded-lg border transition-colors ${
        isError
          ? "border-red-500/30 bg-red-500/5"
          : "border-edge-light bg-surface"
      }`}
    >
      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-surface border border-edge-light p-0.5 text-muted hover:text-heading transition-colors opacity-0 group-hover/att:opacity-100"
      >
        <X size={12} />
      </button>

      {/* Upload overlay */}
      {isUploading && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center rounded-lg bg-black/40 backdrop-blur-[1px]">
          <Spinner size="sm" />
        </div>
      )}

      {/* Error overlay */}
      {isError && (
        <div className="absolute inset-0 z-[5] flex items-center justify-center rounded-lg bg-black/40">
          <AlertCircle size={16} className="text-red-400" />
        </div>
      )}

      {category === "image" && (
        <img
          src={attachment.previewUrl}
          alt={attachment.file.name}
          className="h-20 w-20 rounded-lg object-cover"
        />
      )}

      {category === "video" && (
        <div className="relative h-20 w-20">
          <video
            src={attachment.previewUrl}
            className="h-20 w-20 rounded-lg object-cover"
            muted
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20">
            <Film size={20} className="text-white/80" />
          </div>
        </div>
      )}

      {category === "audio" && (
        <div className="flex h-20 w-36 flex-col items-center justify-center gap-1.5 rounded-lg px-2">
          <Music size={18} className="text-pulse/70" />
          <span className="w-full truncate text-center text-[10px] text-soft">
            {attachment.file.name}
          </span>
          <span className="text-[9px] text-muted">
            {formatFileSize(attachment.file.size)}
          </span>
        </div>
      )}

      {category === "pdf" && (
        <div className="flex h-20 w-36 flex-col items-center justify-center gap-1.5 rounded-lg px-2">
          <FileText size={18} className="text-red-400/70" />
          <span className="w-full truncate text-center text-[10px] text-soft">
            {attachment.file.name}
          </span>
          <span className="text-[9px] text-muted">
            {formatFileSize(attachment.file.size)}
          </span>
        </div>
      )}

      {category === "other" && (
        <div className="flex h-20 w-36 flex-col items-center justify-center gap-1.5 rounded-lg px-2">
          <ImageIcon size={18} className="text-muted" />
          <span className="w-full truncate text-center text-[10px] text-soft">
            {attachment.file.name}
          </span>
          <span className="text-[9px] text-muted">
            {formatFileSize(attachment.file.size)}
          </span>
        </div>
      )}
    </div>
  );
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-2 pb-1 scrollbar-thin scrollbar-thumb-white/10">
      {attachments.map((att) => (
        <AttachmentItem
          key={att.id}
          attachment={att}
          onRemove={() => onRemove(att.id)}
        />
      ))}
    </div>
  );
}
