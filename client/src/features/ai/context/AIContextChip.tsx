import { FileText, MessagesSquare, Mail, User, Users, Hash, Quote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIContextKind } from "@/types/ai";

const ICONS: Record<AIContextKind, typeof FileText> = {
  note: FileText,
  thread: MessagesSquare,
  dm: Mail,
  dmConversation: Mail,
  profile: User,
  space: Users,
  channel: Hash,
  selection: Quote,
};

/** Chip for an attached "Ask AI" context. Shows the actual content preview with
 *  the category as a small caption; falls back to just the category when there's
 *  no preview. With `onDismiss` it renders a remove button (composer). */
export function AIContextChip({
  kind,
  label,
  preview,
  onDismiss,
  className,
}: {
  kind: AIContextKind;
  label: string;
  preview?: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = ICONS[kind] ?? FileText;
  return (
    <span
      title={label}
      className={cn(
        "inline-flex max-w-md items-center gap-2 rounded-lg bg-primary/10 px-2.5 py-1.5 ring-1 ring-primary/20",
        className,
      )}
    >
      <Icon size={14} className="shrink-0 text-primary-soft" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[10px] font-medium uppercase tracking-wide text-primary-soft/80">
          {label}
        </span>
        {preview && (
          <span className="truncate text-xs text-body">{preview}</span>
        )}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-heading"
          title="Remove context"
          aria-label="Remove context"
        >
          <X size={13} />
        </button>
      )}
    </span>
  );
}
