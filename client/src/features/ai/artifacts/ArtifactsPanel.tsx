/**
 * Right-panel canvas for AI artifacts. Lists the active conversation's artifacts
 * and renders the selected one full-size with copy/download/publish actions.
 * Mirrors the Claude-canvas model: chips in the chat open content here.
 */
import { FileText, Code2, BarChart3, Table2, Image as ImageIcon, Shapes } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import {
  selectActiveConversationId,
  selectArtifactIdsForConversation,
  selectOpenArtifactId,
  selectArtifactById,
  setOpenArtifact,
} from "@/store/slices/aiSlice";
import { useAppDispatch } from "@/store/hooks";
import type { AIArtifactType } from "@/types/ai";
import { ArtifactRenderer } from "./ArtifactRenderer";
import { ArtifactActions } from "./ArtifactActions";
import { AIPublishMenu } from "../publish/AIPublishMenu";

const ICONS: Record<AIArtifactType, typeof FileText> = {
  document: FileText,
  code: Code2,
  chart: BarChart3,
  table: Table2,
  image: ImageIcon,
};

export function ArtifactsPanel() {
  const dispatch = useAppDispatch();
  const conversationId = useAppSelector(selectActiveConversationId);
  const artifactIds = useAppSelector(selectArtifactIdsForConversation(conversationId));
  const openId = useAppSelector(selectOpenArtifactId(conversationId));
  // Default to the most recently produced artifact when none is explicitly open.
  const activeId = openId ?? artifactIds[artifactIds.length - 1] ?? null;
  const artifact = useAppSelector(selectArtifactById(activeId ?? ""));

  if (artifactIds.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Shapes size={24} className="mb-2 text-muted opacity-40" />
        <p className="text-xs text-muted">
          Charts, documents, code, and tables the AI produces show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {artifactIds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border p-2">
          {artifactIds.map((id) => (
            <ArtifactTab
              key={id}
              id={id}
              active={id === activeId}
              onSelect={() =>
                conversationId &&
                dispatch(setOpenArtifact({ conversationId, artifactId: id }))
              }
            />
          ))}
        </div>
      )}

      {artifact ? (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="truncate text-sm font-medium text-heading">{artifact.title}</span>
            <ArtifactActions artifact={artifact}>
              <AIPublishMenu text={artifact.content} title={artifact.title} />
            </ArtifactActions>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <ArtifactRenderer artifact={artifact} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted">
          Select an artifact.
        </div>
      )}
    </div>
  );
}

function ArtifactTab({
  id,
  active,
  onSelect,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
}) {
  const artifact = useAppSelector(selectArtifactById(id));
  if (!artifact) return null;
  const Icon = ICONS[artifact.type] ?? FileText;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex max-w-[140px] items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "bg-surface text-muted hover:bg-surface-hover hover:text-heading",
      )}
    >
      <Icon size={12} className="shrink-0" />
      <span className="truncate">{artifact.title}</span>
    </button>
  );
}
