/**
 * Artifacts are a deterministic projection of assistant message text: id =
 * `${messageId}#${index}`. That makes extraction idempotent — re-running on
 * stream completion AND on conversation hydration upserts the same entities, so
 * artifacts survive reload without a dedicated IndexedDB store (the message text,
 * which IS persisted, remains the source of truth).
 */
import { store } from "@/store";
import { addArtifact, setOpenArtifact } from "@/store/slices/aiSlice";
import { setRightPanelOpen, setRightPanelTab } from "@/store/slices/uiSlice";
import type { AIMessage } from "@/types/ai";
import { extractArtifacts } from "./parseArtifacts";

export function artifactId(messageId: string, index: number): string {
  return `${messageId}#${index}`;
}

function messageText(message: AIMessage): string {
  return message.parts
    .filter((p): p is Extract<AIMessage["parts"][number], { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Extract artifacts from a completed assistant message into the slice. Idempotent. */
export function syncArtifactsForMessage(message: AIMessage): string[] {
  if (message.role !== "assistant") return [];
  const parsed = extractArtifacts(messageText(message));
  const ids: string[] = [];
  parsed.forEach((a, i) => {
    const id = artifactId(message.id, i);
    store.dispatch(
      addArtifact({
        id,
        conversationId: message.conversationId,
        sourceMessageId: message.id,
        type: a.type,
        title: a.title,
        language: a.language,
        content: a.content,
        createdAt: message.createdAt,
      }),
    );
    ids.push(id);
  });
  return ids;
}

/** Open an artifact in the right-panel canvas (and ensure the panel is visible). */
export function openArtifactInPanel(conversationId: string, artifactId: string): void {
  store.dispatch(setOpenArtifact({ conversationId, artifactId }));
  store.dispatch(setRightPanelTab({ context: "ai", tab: "artifacts" }));
  store.dispatch(setRightPanelOpen({ context: "ai", open: true }));
}
