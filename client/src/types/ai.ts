/**
 * Core AI-feature types shared by the Redux slice, the engine/provider layer,
 * and the UI. Kept free of secrets — API keys live only in the OS keychain and
 * the `llmManager` singleton, never in any of these shapes.
 */

export type AIProviderKind =
  | "openai-compat" // Ollama, LM Studio, OpenRouter, Deepseek, Kimi, downloaded llama-server
  | "anthropic"
  | "local-llama" // managed/in-process llama-server (openai-compat shape, localhost)
  | "rust-inproc" // reserved mistral.rs in-process slot
  | "image"
  | "audio";

/** A multimodal message part. Text for chat; image/audio for generation I/O. */
export type AIContentPart =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mime: string }
  | { type: "audio"; url: string; mime: string };

export type AIMessageRole = "system" | "user" | "assistant" | "tool";

export type AIMessageStatus = "complete" | "streaming" | "error";

export interface AIToolCall {
  id: string;
  name: string;
  /** JSON string of arguments (assembled from streamed deltas). */
  arguments: string;
}

export interface AIToolResult {
  ok: boolean;
  output: string;
}

export interface AIConversation {
  id: string;
  title: string;
  /** Provider + model active for this conversation (null until first send). */
  providerId: string | null;
  model: string | null;
  systemPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: AIMessageRole;
  parts: AIContentPart[];
  status: AIMessageStatus;
  /** Chain-of-thought from reasoning models (shown collapsed, not resent). */
  reasoning?: string;
  toolCalls?: AIToolCall[];
  toolResults?: Record<string, AIToolResult>;
  artifactIds?: string[];
  /** Attached "Ask AI" context (user turns only). Shown as a chip; framed as
   *  untrusted data when sent to the model. */
  context?: AIContext;
  error?: string;
  createdAt: number;
  /** Token usage for this turn (when the provider reports it). */
  usage?: { promptTokens?: number; completionTokens?: number };
  /** Wall-clock generation time in ms (for tok/s display). */
  genMs?: number;
  /** Time spent reasoning before the answer began, in ms. */
  reasoningMs?: number;
  /** Provider stop reason for the final answer (e.g. "length"/"max_tokens",
   *  "content_filter", "refusal"). Used to flag truncated/refused replies. */
  finishReason?: string;
}

/**
 * A bounded, serializable snapshot of app content the user asks the AI about
 * ("Ask AI" on a note/thread/DM/profile/space/channel). The `text` is a rendered
 * snapshot of UNTRUSTED, attacker-controllable content — it is always framed as
 * data (never instructions) before it reaches a model, and write-tools resolve
 * `refs` against live Redux at execution time rather than trusting the snapshot.
 */
export type AIContextKind =
  | "note"
  | "thread"
  | "dm"
  | "dmConversation"
  | "profile"
  | "space"
  | "channel"
  | "selection";

export interface AIContextRefs {
  /** Source event ids (notes, chat messages). */
  eventIds?: string[];
  /** Pubkeys referenced (authors, profile subject, DM partner). */
  pubkeys?: string[];
  /** naddr / addressable references (articles, tracks). */
  naddr?: string[];
  spaceId?: string;
  channelId?: string;
}

export interface AIContext {
  kind: AIContextKind;
  /** Short category label for the chip, e.g. `Thread by alice`. */
  label: string;
  /** One-line content preview for the chip (truncated/optimized). UNTRUSTED. */
  preview?: string;
  /** Rendered snapshot of the source content (≤ ~8k chars). UNTRUSTED. */
  text: string;
  refs: AIContextRefs;
  /** Instruction seeded into the composer (the user can edit before sending). */
  defaultInstruction: string;
  /** Always "untrusted" — this content is attacker-controllable. */
  trust: "untrusted";
}

export type AIArtifactType = "document" | "code" | "chart" | "image" | "table";

export interface AIArtifact {
  id: string;
  conversationId: string;
  sourceMessageId: string;
  type: AIArtifactType;
  title: string;
  /** For `code`. */
  language?: string;
  /** Markdown/code text, JSON spec for chart/table, or a URL for image. */
  content: string;
  mime?: string;
  createdAt: number;
}

/**
 * A write the model PROPOSED via a tool call but has NOT performed. The agent
 * never signs — it only produces this unsigned draft; the confirmation gate
 * (PendingWriteCard) signs + publishes ONLY on explicit human Approve. Relays
 * and recipients are resolved/allow-listed app-side, never taken from the model.
 */
export type PendingWriteKind = "note" | "reply" | "dm" | "space_message" | "article";

export type PendingWriteStatus =
  | "pending"
  | "publishing"
  | "done"
  | "error"
  | "cancelled";

export interface PendingWrite {
  /** Equals the originating toolCallId — binds the approval to the exact call. */
  id: string;
  conversationId: string;
  /** Assistant message that proposed the write. */
  messageId: string;
  kind: PendingWriteKind;
  /** One-line human summary, e.g. "Post a note" / "DM alice". */
  summary: string;
  /** Editable body shown in the card. */
  content: string;
  /** Article title (kind:article only). */
  title?: string;
  /** Resolved DM recipient (hex). */
  recipientPubkey?: string;
  recipientLabel?: string;
  /** Resolved space/channel target. */
  spaceId?: string;
  channelId?: string;
  /** Reply target (kind:reply only). */
  replyToEventId?: string;
  replyToPubkey?: string;
  status: PendingWriteStatus;
  error?: string;
  /** Outcome after publish, e.g. "Published to 4 relays". */
  result?: string;
  createdAt: number;
}

export type AIProviderStatusKind =
  | "unknown"
  | "connecting"
  | "connected"
  | "error";

export interface AIProviderStatus {
  status: AIProviderStatusKind;
  lastError: string | null;
  models?: AIModelInfo[];
}

export interface AIModelInfo {
  id: string;
  label?: string;
}

/**
 * Non-secret provider configuration. Persisted as a keychain blob via
 * `llmProvidersKey`. The API key is NEVER part of this shape.
 */
export interface AIProviderConfig {
  id: string;
  kind: AIProviderKind;
  label: string;
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 */
  baseUrl: string;
  defaultModel?: string;
  /** false for keyless local engines (Ollama, LM Studio). */
  keyRequired: boolean;
}
