import { memo, useMemo, useState } from "react";
import {
  BrainCircuit,
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronRight,
  Copy,
  Check,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { selectMessageById, selectAIPrefs } from "@/store/slices/aiSlice";
import type { AIMessage } from "@/types/ai";
import { partsToText } from "./engine/buildEngineMessages";
import { AIMarkdown } from "./markdown/AIMarkdown";
import { AIContextChip } from "./context/AIContextChip";
import { ArtifactChip } from "./artifacts/ArtifactChip";
import { artifactId } from "./artifacts/artifactSync";
import { parseArtifactSegments } from "./artifacts/parseArtifacts";
import { AIPublishMenu } from "./publish/AIPublishMenu";
import { regenerateLastTurn } from "./conversationActions";

/** A user-facing note for a non-clean stop reason, or null for clean stops
 *  (end_turn/stop/tool_use/…). The model's reply may be incomplete here. */
function finishReasonNotice(reason?: string): string | null {
  switch (reason) {
    case "length":
    case "max_tokens":
      return "Response was cut off — it reached the model's output limit.";
    case "content_filter":
      return "Response was stopped by the provider's content filter.";
    case "refusal":
      return "The model declined to answer.";
    default:
      return null;
  }
}

/**
 * One chat bubble. User turns render plain text; assistant turns render markdown
 * once complete (parse-once) and stream as plain text. Reasoning is shown in a
 * collapsible panel (gated by the Show-reasoning pref); a hover footer offers
 * copy / regenerate and, when enabled, token stats.
 */
export const AIMessageBubble = memo(function AIMessageBubble({
  messageId,
  conversationId,
  isLast,
}: {
  messageId: string;
  conversationId: string;
  isLast: boolean;
}) {
  const message = useAppSelector(selectMessageById(messageId));
  const prefs = useAppSelector(selectAIPrefs);
  if (!message || message.role === "system") return null;

  const isUser = message.role === "user";
  const text = partsToText(message.parts);
  const isStreaming = message.status === "streaming";
  const reasoning = message.reasoning;
  const showReasoningPanel = prefs.showReasoning && !!reasoning;
  // "Actively thinking" = streaming reasoning before any answer text has arrived.
  const thinking = isStreaming && !text;
  const showDots = thinking && !showReasoningPanel;

  return (
    <div className={cn("group flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <BrainCircuit size={15} />
        </div>
      )}
      <div className={cn("min-w-0 max-w-[80%]", isUser && "flex flex-col items-end")}>
        {isUser && message.context && (
          <div className="mb-1.5 flex max-w-full justify-end">
            <AIContextChip
              kind={message.context.kind}
              label={message.context.label}
              preview={message.context.preview}
            />
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm",
            isUser ? "bg-primary/15 text-heading" : "bg-panel ring-1 ring-border",
          )}
        >
          {showReasoningPanel && (
            <ReasoningBlock
              reasoning={reasoning!}
              thinking={thinking}
              reasoningMs={message.reasoningMs}
            />
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap break-words text-body">{text}</p>
          ) : text ? (
            isStreaming ? (
              <AIMarkdown content={text} streaming />
            ) : (
              <AssistantContent
                messageId={message.id}
                conversationId={conversationId}
                text={text}
              />
            )
          ) : showDots ? (
            <ThinkingDots />
          ) : null}

          {!isUser && !isStreaming && message.toolCalls && message.toolCalls.length > 0 && (
            <div className={cn("flex items-center gap-1.5 text-xs text-muted", text && "mt-2")}>
              <Wrench size={12} />
              <span>Used {message.toolCalls.map((t) => t.name).join(", ")}</span>
            </div>
          )}

          {!isUser && !isStreaming && message.status !== "error" &&
            (() => {
              const notice = finishReasonNotice(message.finishReason);
              return notice ? (
                <div className={cn("flex items-center gap-1.5 text-xs text-amber-400/90", text && "mt-2")}>
                  <AlertTriangle size={13} />
                  <span>{notice}</span>
                </div>
              ) : null;
            })()}

          {message.status === "error" && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-400">
              <AlertCircle size={13} />
              <span>{message.error ?? "Something went wrong."}</span>
            </div>
          )}
        </div>

        {!isUser && !isStreaming && (text || message.status === "error") && (
          <MessageFooter
            text={text}
            message={message}
            conversationId={conversationId}
            isLast={isLast}
            showStats={prefs.showTokenStats}
          />
        )}
      </div>
    </div>
  );
});

/** Completed assistant content: prose rendered as markdown, substantial/
 *  structured blocks replaced by inline artifact chips that open the canvas. */
function AssistantContent({
  messageId,
  conversationId,
  text,
}: {
  messageId: string;
  conversationId: string;
  text: string;
}) {
  const segments = useMemo(() => parseArtifactSegments(text), [text]);
  let artifactIndex = 0;
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "text") return <AIMarkdown key={i} content={seg.text} />;
        const id = artifactId(messageId, artifactIndex++);
        return (
          <ArtifactChip
            key={i}
            conversationId={conversationId}
            artifactId={id}
            type={seg.artifact.type}
            title={seg.artifact.title}
          />
        );
      })}
    </>
  );
}

function MessageFooter({
  text,
  message,
  conversationId,
  isLast,
  showStats,
}: {
  text: string;
  message: AIMessage;
  conversationId: string;
  isLast: boolean;
  showStats: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const time = useRelativeTime(Math.floor(message.createdAt / 1000));
  const copy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted opacity-60 transition-opacity group-hover:opacity-100">
      <span className="tabular-nums" title="When this reply was generated">
        {time}
      </span>
      <button
        onClick={copy}
        className="flex items-center gap-1 rounded p-0.5 transition-colors hover:text-heading"
        title="Copy"
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
      </button>
      {isLast && (
        <button
          onClick={() => void regenerateLastTurn(conversationId)}
          className="flex items-center gap-1 rounded p-0.5 transition-colors hover:text-heading"
          title="Regenerate"
        >
          <RotateCcw size={12} />
        </button>
      )}
      {text && <AIPublishMenu text={text} />}
      {showStats && <TokenStats message={message} />}
    </div>
  );
}

function TokenStats({ message }: { message: AIMessage }) {
  const prompt = message.usage?.promptTokens;
  const completion = message.usage?.completionTokens;
  const stats: React.ReactNode[] = [];
  if (prompt != null) {
    stats.push(
      <span key="in" title="Input tokens — your prompt + any attached context">
        ↑ {prompt} in
      </span>,
    );
  }
  if (completion != null) {
    stats.push(
      <span key="out" title="Output tokens — the model's response">
        ↓ {completion} out
      </span>,
    );
  }
  if (completion != null && message.genMs && message.genMs > 0) {
    const tps = completion / (message.genMs / 1000);
    stats.push(
      <span key="tps" title="Generation speed (output tokens per second)">
        {tps.toFixed(1)} tok/s
      </span>,
    );
  } else if (message.genMs) {
    stats.push(
      <span key="ms" title="Total generation time">
        {(message.genMs / 1000).toFixed(1)}s
      </span>,
    );
  }
  if (stats.length === 0) return null;
  return (
    <span className="ml-1 flex items-center gap-1.5 tabular-nums">
      {stats.map((s, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">·</span>}
          {s}
        </span>
      ))}
    </span>
  );
}

function ReasoningBlock({
  reasoning,
  thinking,
  reasoningMs,
}: {
  reasoning: string;
  thinking: boolean;
  reasoningMs?: number;
}) {
  // Auto: expanded while actively thinking, collapsed once the answer begins.
  // A user click pins the state thereafter.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? thinking;

  const label = thinking
    ? "Thinking…"
    : reasoningMs
      ? `Thought for ${(reasoningMs / 1000).toFixed(1)}s`
      : "Thought process";

  return (
    <div className={cn(!thinking && "mb-2")}>
      <button
        onClick={() => setOverride(!open)}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-soft"
      >
        <Brain size={12} className={cn(thinking && "animate-pulse text-primary")} />
        <span>{label}</span>
        <ChevronRight
          size={12}
          className={cn("transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-1.5 max-h-80 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-xs leading-relaxed text-muted">
          {reasoning}
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      <span className="sr-only">Thinking…</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}
