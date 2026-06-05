import { nanoid } from "nanoid";
import type { AIModelInfo, AIProviderConfig } from "@/types/ai";
import { engineFetch } from "../httpFetch";
import { parseSSE } from "../sse";
import { createThinkSplitter } from "../thinkSplitter";
import { extraHeadersForBaseUrl } from "../providerCatalog";
import { describeError, contentToText } from "../providerUtil";
import type {
  ChatChunk,
  ChatOptions,
  EngineChatMessage,
  LLMProvider,
  StreamingToolCall,
  ToolDefinition,
} from "../types";

/**
 * OpenAI Chat Completions adapter. Covers every backend that speaks that wire
 * format: OpenAI, OpenRouter, DeepSeek, Kimi, Ollama, LM Studio, and the
 * downloaded llama-server — parameterized only by `baseUrl` + an optional bearer
 * key. The key is read lazily via `getKey` so it never lives on the provider.
 */
export function makeOpenAICompatProvider(
  config: AIProviderConfig,
  getKey: () => string | null,
): LLMProvider {
  const base = config.baseUrl.replace(/\/+$/, "");

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      ...extraHeadersForBaseUrl(base),
    };
    const key = getKey();
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  async function* chat(
    messages: EngineChatMessage[],
    opts: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    let res: Response;
    try {
      res = await engineFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: toOpenAIMessages(messages, opts.systemPrompt),
          ...(opts.tools?.length ? { tools: toOpenAITools(opts.tools) } : {}),
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
      yield { type: "error", message: "No response body from engine." };
      return;
    }

    const toolAcc = new Map<number, StreamingToolCall>();
    const splitter = createThinkSplitter();
    let finishReason: string | undefined;
    try {
      for await (const data of parseSSE(res.body)) {
        if (data === "[DONE]") break;
        let json: OpenAIStreamChunk;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage) {
          yield {
            type: "usage",
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
          };
        }
        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        // Reasoning models expose chain-of-thought either via a dedicated field
        // (DeepSeek/OpenRouter) or inline <think>…</think> in `content`.
        const reasoningField = delta?.reasoning_content ?? delta?.reasoning;
        if (reasoningField) yield { type: "reasoning", delta: reasoningField };
        if (delta?.content) {
          for (const piece of splitter.push(delta.content)) {
            yield piece.kind === "reasoning"
              ? { type: "reasoning", delta: piece.text }
              : { type: "text", delta: piece.text };
          }
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const acc = toolAcc.get(idx) ?? { id: "", name: "", arguments: "" };
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            toolAcc.set(idx, acc);
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      for (const piece of splitter.flush()) {
        yield piece.kind === "reasoning"
          ? { type: "reasoning", delta: piece.text }
          : { type: "text", delta: piece.text };
      }
    } catch (e) {
      yield { type: "error", message: describeError(e) };
      return;
    }

    // Some local servers omit the id on tool-call deltas, or leak a content-only
    // fragment with no name. Synthesize a stable id (id-less servers would
    // otherwise collide downstream) and drop nameless fragments.
    const calls = [...toolAcc.entries()]
      .filter(([, c]) => c.name.trim().length > 0)
      .map(([idx, c]) => ({ ...c, id: c.id || `call_${idx}_${nanoid(6)}` }));
    if (calls.length > 0) {
      yield { type: "tool_call", toolCalls: calls };
    }
    yield { type: "done", finishReason };
  }

  async function listModels(): Promise<AIModelInfo[]> {
    const res = await engineFetch(`${base}/models`, { headers: headers() });
    if (!res.ok) {
      throw new Error(`Models request failed: ${res.status}`);
    }
    const json = (await res.json()) as { data?: { id: string }[] };
    return (json.data ?? []).map((m) => ({ id: m.id }));
  }

  async function testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await listModels();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: describeError(e) };
    }
  }

  return { id: config.id, kind: config.kind, chat, listModels, testConnection };
}

function toOpenAIMessages(
  messages: EngineChatMessage[],
  systemPrompt?: string,
): unknown[] {
  const out: unknown[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });
  for (const m of messages) {
    const msg: Record<string, unknown> = {
      role: m.role,
      content: contentToText(m.content),
    };
    if (m.toolCallId) msg.tool_call_id = m.toolCallId;
    if (m.name) msg.name = m.name;
    if (m.toolCalls?.length) {
      msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments || "{}" },
      }));
    }
    out.push(msg);
  }
  return out;
}

function toOpenAITools(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

interface OpenAIStreamChunk {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
}
