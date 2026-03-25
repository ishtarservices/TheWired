import { X, Pencil } from "lucide-react";

interface ChatEditBannerProps {
  originalContent: string;
  onCancel: () => void;
}

export function ChatEditBanner({ originalContent, onCancel }: ChatEditBannerProps) {
  const preview = originalContent.length > 60
    ? originalContent.slice(0, 60) + "..."
    : originalContent;

  return (
    <div className="flex items-center gap-2 border-t border-border bg-panel px-4 py-2">
      <div className="h-4 w-0.5 rounded-full bg-amber-400" />
      <Pencil size={12} className="text-amber-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-xs text-soft">Editing message</span>
        <p className="text-xs text-muted truncate">{preview}</p>
      </div>
      <button
        onClick={onCancel}
        className="ml-auto text-muted hover:text-body transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
