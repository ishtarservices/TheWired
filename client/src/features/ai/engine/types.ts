import type { AIContentPart, AIModelInfo, AIProviderKind } from "@/types/ai";

/** A message as sent to a provider (wire shape, normalized across backends). */
export interface EngineChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AIContentPart[];
  /** For role:"tool" — the tool_call this result answers. */
  toolCallId?: string;
  name?: string;
  /** For role:"assistant" — tool calls the model made (re-sent so the provider's
   *  tool-calling contract is satisfied on follow-up turns). */
  toolCalls?: StreamingToolCall[];
}

/** A tool/function the model may call (JSON Schema params). Used in Phase 1+. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamingToolCall {
  id: string;
  name: string;
  /** JSON string (assembled from streamed argument deltas). */
  arguments: string;
}

/** Normalized streaming chunk — every backend reduces to this union. */
export type ChatChunk =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; toolCalls: StreamingToolCall[] }
  | { type: "image"; url: string; mime: string }
  | { type: "audio"; url: string; mime: string }
  | { type: "usage"; promptTokens?: number; completionTokens?: number }
  | { type: "error"; message: string }
  | { type: "done"; finishReason?: string };

export interface ChatOptions {
  model: string;
  stream?: boolean;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMProvider {
  readonly id: string;
  readonly kind: AIProviderKind;
  chat(messages: EngineChatMessage[], opts: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<AIModelInfo[]>;
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
