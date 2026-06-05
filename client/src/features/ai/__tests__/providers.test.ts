import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatChunk, EngineChatMessage } from "../engine/types";

// Capture requests + drive the SSE response body per test.
const fx = vi.hoisted(() => ({
  calls: [] as { url: string; init: { body?: string } }[],
  sse: [] as string[],
  ok: true,
  errorBody: "boom",
}));

function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const text = events.map((e) => `data: ${e}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

vi.mock("../engine/httpFetch", () => ({
  engineFetch: async (url: string, init: { body?: string }) => {
    fx.calls.push({ url, init });
    return {
      ok: fx.ok,
      status: fx.ok ? 200 : 429,
      statusText: fx.ok ? "OK" : "Too Many Requests",
      body: sseStream(fx.sse),
      text: async () => (fx.ok ? "" : fx.errorBody),
      json: async () => ({ data: [] }),
    } as unknown as Response;
  },
  engineFetchWithTimeout: async () => ({ ok: true, json: async () => ({}) }) as unknown as Response,
}));

import { makeOpenAICompatProvider } from "../engine/providers/openaiCompat";
import { makeAnthropicProvider } from "../engine/providers/anthropic";

const ev = (o: unknown) => JSON.stringify(o);

async function collect(it: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(fx.calls[fx.calls.length - 1].init.body!);
}

beforeEach(() => {
  fx.calls = [];
  fx.sse = [];
  fx.ok = true;
});

const OAI_CONFIG = {
  id: "p",
  kind: "openai-compat" as const,
  label: "x",
  baseUrl: "http://localhost:1234/v1",
  keyRequired: false,
};

describe("openaiCompat.chat — SSE → ChatChunk", () => {
  it("streams text deltas, reassembles tool calls, and reports usage + done", async () => {
    fx.sse = [
      ev({ choices: [{ delta: { content: "Hel" } }] }),
      ev({ choices: [{ delta: { content: "lo" } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "get_profile", arguments: '{"pub' } }] } }] }),
      ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'key":"x"}' } }] }, finish_reason: "tool_calls" }] }),
      ev({ usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [] }),
      "[DONE]",
    ];
    const provider = makeOpenAICompatProvider(OAI_CONFIG, () => null);
    const chunks = await collect(provider.chat([{ role: "user", content: "hi" }], { model: "m", stream: true }));

    const text = chunks.filter((c) => c.type === "text").map((c) => (c as { delta: string }).delta).join("");
    expect(text).toBe("Hello");

    const tool = chunks.find((c) => c.type === "tool_call") as { toolCalls: { id: string; name: string; arguments: string }[] } | undefined;
    expect(tool?.toolCalls).toEqual([{ id: "t1", name: "get_profile", arguments: '{"pubkey":"x"}' }]);

    const usage = chunks.find((c) => c.type === "usage") as { promptTokens: number; completionTokens: number } | undefined;
    expect(usage).toMatchObject({ promptTokens: 5, completionTokens: 2 });
    expect(chunks[chunks.length - 1].type).toBe("done");
  });

  it("serializes assistant tool_calls + tool results into the request (round-trip contract)", async () => {
    fx.sse = ["[DONE]"];
    const provider = makeOpenAICompatProvider(OAI_CONFIG, () => "secret");
    const messages: EngineChatMessage[] = [
      { role: "user", content: "who is alice" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "get_profile", arguments: '{"pubkey":"alice"}' }] },
      { role: "tool", toolCallId: "t1", name: "get_profile", content: "alice is …" },
    ];
    await collect(
      provider.chat(messages, {
        model: "m",
        stream: true,
        tools: [{ name: "get_profile", description: "d", parameters: { type: "object" } }],
      }),
    );
    const body = lastBody();
    const msgs = body.messages as Record<string, unknown>[];
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "get_profile", arguments: '{"pubkey":"alice"}' } },
    ]);
    const toolMsg = msgs.find((m) => m.role === "tool")!;
    expect(toolMsg).toMatchObject({ tool_call_id: "t1", content: "alice is …" });
    expect((body.tools as unknown[]).length).toBe(1);
  });

  it("surfaces a non-ok HTTP response as a single error chunk (no throw)", async () => {
    fx.ok = false;
    fx.errorBody = "rate limited";
    const provider = makeOpenAICompatProvider(OAI_CONFIG, () => null);
    const chunks = await collect(provider.chat([{ role: "user", content: "x" }], { model: "m", stream: true }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("error");
    expect((chunks[0] as { message: string }).message).toContain("429");
  });
});

const ANT_CONFIG = {
  id: "a",
  kind: "anthropic" as const,
  label: "Claude",
  baseUrl: "https://api.anthropic.com/v1",
  keyRequired: true,
};

describe("anthropic.chat — events → ChatChunk", () => {
  it("streams text, reassembles tool_use input, reports usage + done", async () => {
    fx.sse = [
      ev({ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } }),
      ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
      ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "get_profile" } }),
      ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"pubkey":"x"}' } }),
      ev({ type: "message_delta", usage: { output_tokens: 3 } }),
      ev({ type: "message_stop" }),
    ];
    const provider = makeAnthropicProvider(ANT_CONFIG, () => "key");
    const chunks = await collect(provider.chat([{ role: "user", content: "hi" }], { model: "claude", stream: true }));

    expect(chunks.filter((c) => c.type === "text").map((c) => (c as { delta: string }).delta).join("")).toBe("Hi");
    const tool = chunks.find((c) => c.type === "tool_call") as { toolCalls: { id: string; arguments: string }[] } | undefined;
    expect(tool?.toolCalls).toEqual([{ id: "tu1", name: "get_profile", arguments: '{"pubkey":"x"}' }]);
    expect(chunks.find((c) => c.type === "usage")).toBeTruthy();
    expect(chunks[chunks.length - 1].type).toBe("done");
  });

  it("serializes system + tool_use/tool_result blocks (round-trip contract)", async () => {
    fx.sse = [ev({ type: "message_stop" })];
    const provider = makeAnthropicProvider(ANT_CONFIG, () => "key");
    const messages: EngineChatMessage[] = [
      { role: "user", content: "who is alice" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "get_profile", arguments: '{"pubkey":"alice"}' }] },
      { role: "tool", toolCallId: "t1", name: "get_profile", content: "alice is …" },
    ];
    await collect(
      provider.chat(messages, {
        model: "claude",
        stream: true,
        systemPrompt: "be nice",
        tools: [{ name: "get_profile", description: "d", parameters: { type: "object" } }],
      }),
    );
    const body = lastBody();
    expect(body.system).toContain("be nice");
    const msgs = body.messages as { role: string; content: unknown }[];
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.content).toEqual([
      { type: "tool_use", id: "t1", name: "get_profile", input: { pubkey: "alice" } },
    ]);
    const toolResult = msgs.find(
      (m) => Array.isArray(m.content) && (m.content as { type: string }[])[0]?.type === "tool_result",
    )!;
    expect((toolResult.content as { tool_use_id: string; content: string }[])[0]).toMatchObject({
      tool_use_id: "t1",
      content: "alice is …",
    });
    expect((body.tools as { input_schema: unknown }[])[0].input_schema).toBeTruthy();
  });
});
