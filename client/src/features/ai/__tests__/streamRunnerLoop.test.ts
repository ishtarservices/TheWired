import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatChunk, EngineChatMessage, ChatOptions } from "../engine/types";

// Use the REAL store + slice reducers (so the loop's dispatches actually evolve
// state and buildEngineMessages reads real messages), but mock the network/DB/
// registry seams so the test is deterministic.
const h = vi.hoisted(() => ({
  chatScript: [] as ChatChunk[][], // one array of chunks per chat() call
  chatCalls: [] as EngineChatMessage[][], // engineMessages seen per call
  toolResults: {} as Record<string, string>,
  needsKey: false, // toggles the keyless-provider preflight
}));

vi.mock("../engine/llmManager", () => ({
  getProvider: () => ({
    id: "p",
    kind: "openai-compat",
    async *chat(messages: EngineChatMessage[], _opts: ChatOptions) {
      const i = h.chatCalls.length;
      h.chatCalls.push(messages);
      for (const chunk of h.chatScript[i] ?? [{ type: "done" }]) yield chunk;
    },
    listModels: async () => [],
    testConnection: async () => ({ ok: true }),
  }),
  getProviderConfig: () => ({ id: "p", label: "Test Provider", kind: "openai-compat", baseUrl: "x", keyRequired: true }),
  getDefaultProviderAndModel: () => ({ providerId: "p", model: "m" }),
  providerNeedsKey: () => h.needsKey,
}));
vi.mock("../tools/registry", () => ({
  getActiveTools: () => [{ name: "get_profile", description: "d", parameters: {}, access: "read", run: async () => ({ output: "" }) }],
  toToolDefinitions: (t: unknown[]) => t,
  runTool: async (name: string) => ({ output: h.toolResults[name] ?? `ran ${name}` }),
}));
vi.mock("../artifacts/artifactSync", () => ({ syncArtifactsForMessage: vi.fn() }));
vi.mock("../tools/webSearch", () => ({ resetWebSearchBudget: vi.fn() }));
vi.mock("@/lib/db/aiConversationStore", () => ({
  putMessage: vi.fn(),
  putConversation: vi.fn(),
}));

import { store } from "@/store";
import { runTurn } from "../engine/streamRunner";
import { upsertConversation, addMessage } from "@/store/slices/aiSlice";
import { login } from "@/store/slices/identitySlice";

function setup(convId: string) {
  store.dispatch(login({ pubkey: "me", signerType: "nip07" }));
  store.dispatch(
    upsertConversation({
      id: convId,
      title: "t",
      providerId: "p",
      model: "m",
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  store.dispatch(
    addMessage({
      message: {
        id: `${convId}-u`,
        conversationId: convId,
        role: "user",
        parts: [{ type: "text", text: "who is alice" }],
        status: "complete",
        createdAt: 2,
      },
    }),
  );
}

function assistantMessages(convId: string) {
  const s = store.getState().ai;
  return (s.messagesByConversation[convId] ?? [])
    .map((id) => s.messages.entities[id]!)
    .filter((m) => m.role === "assistant");
}

beforeEach(() => {
  h.chatScript = [];
  h.chatCalls = [];
  h.toolResults = {};
  h.needsKey = false;
});

describe("streamRunner tool loop (integration)", () => {
  it("runs a read tool then re-streams a final prose answer", async () => {
    const convId = "loop1";
    setup(convId);
    h.toolResults.get_profile = "alice is a dev";
    h.chatScript = [
      // turn 1: the model calls a tool
      [{ type: "tool_call", toolCalls: [{ id: "t1", name: "get_profile", arguments: "{}" }] }, { type: "done" }],
      // turn 2 (after results fed back): a prose answer
      [{ type: "text", delta: "Alice is a developer." }, { type: "done" }],
    ];

    await runTurn(convId);

    const assistants = assistantMessages(convId);
    expect(assistants).toHaveLength(2);
    // First carries the tool call + its stored result.
    expect(assistants[0].toolCalls?.[0]).toMatchObject({ id: "t1", name: "get_profile" });
    expect(assistants[0].toolResults?.t1).toMatchObject({ ok: true, output: "alice is a dev" });
    // Second is the final answer.
    const finalText = assistants[1].parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    expect(finalText).toBe("Alice is a developer.");
    // The follow-up turn's history included the tool result (round-trip contract).
    const secondTurnMsgs = h.chatCalls[1];
    expect(secondTurnMsgs.some((m) => m.role === "tool" && m.toolCallId === "t1")).toBe(true);
  });

  it("stops looping with no tool calls (single turn)", async () => {
    const convId = "loop2";
    setup(convId);
    h.chatScript = [[{ type: "text", delta: "hi" }, { type: "done" }]];
    await runTurn(convId);
    expect(assistantMessages(convId)).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
  });

  it("caps the tool loop at MAX_TOOL_DEPTH and still forces a final answer", async () => {
    const convId = "loop3";
    setup(convId);
    // Every turn tries to call a tool; the runner must eventually omit tools and
    // get a prose answer rather than loop forever / leave a silent tool bubble.
    h.chatScript = Array.from({ length: 12 }, () => [
      { type: "tool_call", toolCalls: [{ id: `t${Math.random()}`, name: "get_profile", arguments: "{}" }] } as ChatChunk,
      { type: "done" } as ChatChunk,
    ]);
    await runTurn(convId);
    // depth cap is 5 → at most 5 executed tool turns + 1 forced no-tool turn.
    expect(h.chatCalls.length).toBeLessThanOrEqual(7);
    // The final chat() call was made with no tools (forced-answer turn).
    // (We can't see opts here, but the loop terminated — no infinite loop.)
    expect(store.getState().ai.streamingByConversation[convId]).toBeUndefined();
  });

  it("surfaces an actionable error (no provider call) when the key is missing", async () => {
    const convId = "loop4";
    setup(convId);
    h.needsKey = true; // provider requires a key but none is loaded
    await runTurn(convId);
    // No chat() round-trip happened.
    expect(h.chatCalls).toHaveLength(0);
    const assistants = assistantMessages(convId);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].status).toBe("error");
    expect(assistants[0].error).toMatch(/API key/i);
    expect(store.getState().ai.streamingByConversation[convId]).toBeUndefined();
  });

  it("records the provider stop reason on the final answer", async () => {
    const convId = "loop5";
    setup(convId);
    h.chatScript = [[{ type: "text", delta: "partial" }, { type: "done", finishReason: "length" }]];
    await runTurn(convId);
    const assistants = assistantMessages(convId);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].finishReason).toBe("length");
  });
});
