import { FileText, Code2, BarChart3, Table2, Image as ImageIcon, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import { selectOpenArtifactId } from "@/store/slices/aiSlice";
import type { AIArtifactType } from "@/types/ai";
import { openArtifactInPanel } from "./artifactSync";

const ICONS: Record<AIArtifactType, typeof FileText> = {
  document: FileText,
  code: Code2,
  chart: BarChart3,
  table: Table2,
  image: ImageIcon,
};

const TYPE_LABEL: Record<AIArtifactType, string> = {
  document: "Document",
  code: "Code",
  chart: "Chart",
  table: "Table",
  image: "Image",
};

/** Interactive inline reference to an artifact — clicking opens it in the canvas.
 *  Styled as a button-y pill (not a static badge) per artifacts-UX research. */
export function ArtifactChip({
  conversationId,
  artifactId,
  type,
  title,
}: {
  conversationId: string;
  artifactId: string;
  type: AIArtifactType;
  title: string;
}) {
  const Icon = ICONS[type] ?? FileText;
  const openId = useAppSelector(selectOpenArtifactId(conversationId));
  const isOpen = openId === artifactId;

  return (
    <button
      onClick={() => openArtifactInPanel(conversationId, artifactId)}
      className={cn(
        "my-2 flex w-full max-w-md items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
        isOpen
          ? "border-primary/40 bg-primary/10"
          : "border-border bg-surface hover:border-primary/30 hover:bg-surface-hover",
      )}
      title="Open in panel"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-heading">{title}</span>
        <span className="block text-xs text-muted">{TYPE_LABEL[type]}</span>
      </span>
      <ArrowUpRight size={15} className="shrink-0 text-muted" />
    </button>
  );
}
