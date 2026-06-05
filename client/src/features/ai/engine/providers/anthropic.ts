import { nanoid } from "nanoid";
import type { AIModelInfo, AIProviderConfig } from "@/types/ai";
import { engineFetch } from "../httpFetch";
import { parseSSE } from "../sse";
import { getPreset } from "../providerCatalog";
import { describeError, contentToText } from "../providerUtil";
import type {
  ChatChunk,
  ChatOptions,
  EngineChatMessage,
  LLMProvider,
  StreamingToolCall,
  ToolDefinition,
} from "../types";

const ANTHROPIC_VERSION = "2023-06-01";
// 4096 truncated long answers/articles (publish_article allows a 20k-char body).
// 8192 is broadly supported and covers our artifact/article sizes.
const DEFAULT_MAX_TOKENS = 8192;

/**
 * Anthropic Messages API adapter. Different envelope from OpenAI: a top-level
 * `system` field, `x-api-key` auth, and `content_block_delta` streaming events.
 * Reduced to the same `ChatChunk` union as every other provider.
 */
export function makeAnthropicProvider(
  config: AIProviderConfig,
  getKey: () => string | null,
): LLMProvider {
  const base = config.baseUrl.replace(/\/+$/, "");

  function headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": getKey() ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
      // Required when calling the API from a browser-like context (web build).
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }

  async function* chat(
    messages: EngineChatMessage[],
    opts: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const { system, msgs } = splitSystem(messages, opts.systemPrompt);
    let res: Response;
    try {
      res = await engineFetch(`${base}/messages`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model: opts.model,
          max_tokens: DEFAULT_MAX_TOKENS,
          stream: true,
          ...(system ? { system } : {}),
          messages: msgs,
          ...(opts.tools?.length ? { tools: toAnthropicTools(opts.tools) } : {}),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        }),
        signal: opts.signal,
      });
    } catch (e) {
      yield { type: "error", message: describeError(e) };
      return;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      yield { type: "error", message: `${res.status}: ${detail.slice(0, 300)}` };
      return;
    }
    if (!res.body) {
      yield { type: "error", message: "No response body from Anthropic." };
      return;
    }

    // tool_use blocks accumulate their JSON via input_json_delta, keyed by index.
    const toolAcc = new Map<number, StreamingToolCall>();
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let stopReason: string | undefined;
    try {
      for await (const data of parseSSE(res.body)) {
        let ev: AnthropicEvent;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === "message_start" && ev.message?.usage) {
          promptTokens = ev.message.usage.input_tokens;
          completionTokens = ev.message.usage.output_tokens;
        } else if (ev.type === "message_delta") {
          if (ev.usage?.output_tokens != null) completionTokens = ev.usage.output_tokens;
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        }
        if (
          ev.type === "content_block_start" &&
          ev.content_block?.type === "tool_use"
        ) {
          toolAcc.set(ev.index ?? 0, {
            id: ev.content_block.id ?? "",
            name: ev.content_block.name ?? "",
            arguments: "",
          });
        } else if (ev.type === "content_block_delta") {
          if (ev.delta?.type === "text_delta" && ev.delta.text) {
            yield { type: "text", delta: ev.delta.text };
          } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
            yield { type: "reasoning", delta: ev.delta.thinking };
          } else if (
            ev.delta?.type === "input_json_delta" &&
            ev.delta.partial_json
          ) {
            const acc = toolAcc.get(ev.index ?? 0);
            if (acc) acc.arguments += ev.delta.partial_json;
          }
        } else if (ev.type === "message_stop") {
          break;
        } else if (ev.type === "error") {
          yield {
            type: "error",
            message: ev.error?.message ?? "Anthropic stream error.",
          };
          return;
        }
      }
    } catch (e) {
      yield { type: "error", message: describeError(e) };
      return;
    }

    const calls = [...toolAcc.entries()]
      .filter(([, c]) => c.name.trim().length > 0)
      .map(([idx, c]) => ({ ...c, id: c.id || `call_${idx}_${nanoid(6)}` }));
    if (calls.length > 0) {
      yield { type: "tool_call", toolCalls: calls };
    }
    if (promptTokens != null || completionTokens != null) {
      yield { type: "usage", promptTokens, completionTokens };
    }
    yield { type: "done", finishReason: stopReason };
  }

  async function listModels(): Promise<AIModelInfo[]> {
    try {
      const res = await engineFetch(`${base}/models`, { headers: headers() });
      if (res.ok) {
        const json = (await res.json()) as {
          data?: { id: string; display_name?: string }[];
        };
        const models = (json.data ?? []).map((m) => ({
          id: m.id,
          label: m.display_name,
        }));
        if (models.length) return models;
      }
    } catch {
      /* fall through to the static list */
    }
    return (getPreset("anthropic")?.defaultModels ?? []).map((id) => ({ id }));
  }

  async function testConnection(): Promise<{ ok: boolean; error?: string }> {
    if (!getKey()) return { ok: false, error: "API key required." };
    try {
      const res = await engineFetch(`${base}/models`, { headers: headers() });
      if (res.ok) return { ok: true };
      const detail = await res.text().catch(() => res.statusText);
      return { ok: false, error: `${res.status}: ${detail.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  }

  return { id: config.id, kind: config.kind, chat, listModels, testConnection };
}

interface AnthropicMsg {
  role: "user" | "assistant";
  content: unknown;
}

function splitSystem(
  messages: EngineChatMessage[],
  systemPrompt?: string,
): { system: string; msgs: AnthropicMsg[] } {
  const systemParts: string[] = [];
  if (systemPrompt) systemParts.push(systemPrompt);
  const msgs: AnthropicMsg[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(contentToText(m.content));
      continue;
    }

    if (m.role === "tool") {
      // Anthropic represents tool results as tool_result blocks inside a USER
      // message; merge consecutive results (parallel calls) into one message.
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: contentToText(m.content) };
      const last = msgs[msgs.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        msgs.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      const blocks: unknown[] = [];
      const text = contentToText(m.content);
      if (text) blocks.push({ type: "text", text });
      for (const tc of m.toolCalls) {
        let input: unknown = {};
        try {
          input = tc.arguments ? JSON.parse(tc.arguments) : {};
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input });
      }
      msgs.push({ role: "assistant", content: blocks });
      continue;
    }

    msgs.push({ role: m.role === "assistant" ? "assistant" : "user", content: contentToText(m.content) });
  }
  return { system: systemParts.join("\n\n"), msgs };
}

function toAnthropicTools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    /** Present on `message_delta` — "end_turn" | "max_tokens" | "tool_use" | "refusal" … */
    stop_reason?: string;
  };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}
