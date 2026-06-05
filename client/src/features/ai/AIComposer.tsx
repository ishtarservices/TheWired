import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectIsStreaming,
  selectPendingContext,
  selectMessageIdsForConversation,
  setPendingContext,
} from "@/store/slices/aiSlice";
import { createConversation, sendUserMessage } from "./conversationActions";
import { stopTurn } from "./engine/streamRunner";
import { AIContextChip } from "./context/AIContextChip";
import { AIModelPicker } from "./AIModelPicker";

const SUGGESTIONS = [
  "Explain how Nostr relays work",
  "Draft a short intro note about me",
  "Give me 3 post ideas for today",
];

export function AIComposer({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useAppSelector(selectIsStreaming(conversationId));
  const pendingContext = useAppSelector(selectPendingContext);
  const messageIds = useAppSelector(selectMessageIdsForConversation(conversationId));
  const hasProviders = useAppSelector(
    (s) => Object.keys(s.ai.providers).length > 0,
  );
  const showSuggestions =
    hasProviders && !pendingContext && !isStreaming && messageIds.length === 0;

  const prefill = (prompt: string) => {
    setText(prompt);
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      requestAnimationFrame(grow);
    }
  };

  // Seed the composer with the staged context's instruction when "Ask AI" fires.
  // Keyed on the context object identity (a fresh one per Ask AI), so it never
  // clobbers what the user is typing afterward.
  useEffect(() => {
    if (!pendingContext) return;
    setText(pendingContext.defaultInstruction);
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      requestAnimationFrame(grow);
    }
  }, [pendingContext]);

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !hasProviders) return;
    setText("");
    requestAnimationFrame(grow);
    const context = pendingContext ?? undefined;
    if (pendingContext) dispatch(setPendingContext(null));
    const cid = conversationId ?? createConversation();
    void sendUserMessage(cid, trimmed, context);
  };

  const stop = () => {
    if (conversationId) stopTurn(conversationId);
  };

  return (
    <div className="border-t border-border px-3 py-2.5">
      <div className="mx-auto max-w-3xl">
        {!hasProviders && (
          <button
            onClick={() => navigate("/settings?tab=ai")}
            className="mb-1.5 text-xs text-primary hover:underline"
          >
            Add a provider in Settings → AI
          </button>
        )}

        {showSuggestions && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => prefill(s)}
                className="rounded-full bg-surface px-3 py-1 text-xs text-soft ring-1 ring-border transition-colors hover:bg-surface-hover hover:text-heading"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {pendingContext && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <AIContextChip
              kind={pendingContext.kind}
              label={pendingContext.label}
              preview={pendingContext.preview}
              onDismiss={() => dispatch(setPendingContext(null))}
            />
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl bg-field p-2 ring-1 ring-border focus-within:ring-primary/30">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && isStreaming) {
                e.preventDefault();
                stop();
              }
            }}
            rows={1}
            placeholder={hasProviders ? "Ask anything…" : "Connect an AI provider to start"}
            disabled={!hasProviders}
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-heading placeholder-muted focus:outline-none disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={stop}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface text-heading transition-colors hover:bg-surface-hover"
              title="Stop"
              aria-label="Stop generating"
            >
              <Square size={14} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!text.trim() || !hasProviders}
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                text.trim() && hasProviders
                  ? "bg-primary text-primary-fg hover:brightness-110"
                  : "bg-surface text-muted",
              )}
              title="Send"
              aria-label="Send message"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>

        {hasProviders && (
          <div className="mt-1 flex items-center justify-between px-1">
            <AIModelPicker conversationId={conversationId} />
            <span className="hidden text-[10px] text-muted sm:block">
              Enter to send · Shift+Enter for newline
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
