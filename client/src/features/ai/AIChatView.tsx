import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { BrainCircuit, Settings } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectActiveConversationId,
  selectConversationById,
  evictConversationMessages,
} from "@/store/slices/aiSlice";
import { AIMessageList } from "./AIMessageList";
import { AIComposer } from "./AIComposer";
import { AIModelPicker } from "./AIModelPicker";
import { hydrateConversation } from "./conversationActions";

/** Center panel for the AI tab: header + message list + composer. */
export function AIChatView() {
  const dispatch = useAppDispatch();
  const activeId = useAppSelector(selectActiveConversationId);
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (activeId) void hydrateConversation(activeId);
    // Evict the previously-active conversation's messages from Redux on switch
    // (IDB stays canonical; the reducer skips active/streaming conversations) so
    // a long session opening many chats doesn't grow memory unbounded.
    const prev = prevId.current;
    if (prev && prev !== activeId) dispatch(evictConversationMessages(prev));
    prevId.current = activeId;
  }, [activeId, dispatch]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AIChatHeader conversationId={activeId} />
      {activeId ? <AIMessageList conversationId={activeId} /> : <AIEmptyState />}
      <AIComposer conversationId={activeId} />
    </div>
  );
}

function AIChatHeader({ conversationId }: { conversationId: string | null }) {
  const navigate = useNavigate();
  const conversation = useAppSelector(selectConversationById(conversationId ?? ""));
  const title = conversation?.title ?? "AI";

  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <BrainCircuit size={16} className="shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold text-heading">{title}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <AIModelPicker conversationId={conversationId} />
        <button
          onClick={() => navigate("/settings?tab=ai")}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading"
          title="AI settings"
          aria-label="AI settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </div>
  );
}

function AIEmptyState() {
  const hasProviders = useAppSelector(
    (s) => Object.keys(s.ai.providers).length > 0,
  );
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <BrainCircuit size={22} />
        </div>
        <h3 className="text-sm font-semibold text-heading">
          {hasProviders ? "Start a conversation" : "Set up AI"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
          {hasProviders
            ? "Ask a question below. Your conversations stay on this device."
            : "Connect a local engine (Ollama, LM Studio) or add an API key in Settings → AI to begin."}
        </p>
      </div>
    </div>
  );
}
