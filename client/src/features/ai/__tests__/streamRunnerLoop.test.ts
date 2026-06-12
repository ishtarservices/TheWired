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
  runToolCalls: [] as string[], // tool names actually EXECUTED (not stubbed)
  onRunTool: undefined as undefined | ((name: string, ctx: unknown) => void | Promise<void>),
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
  runTool: async (name: string, _args: string, ctx: unknown) => {
    h.runToolCalls.push(name);
    if (h.onRunTool) await h.onRunTool(name, ctx);
    return { output: h.toolResults[name] ?? `ran ${name}` };
  },
}));
vi.mock("../artifacts/artifactSync", () => ({ syncArtifactsForMessage: vi.fn() }));
vi.mock("../tools/webSearch", () => ({ resetWebSearchBudget: vi.fn() }));
vi.mock("@/lib/db/aiConversationStore", () => ({
  putMessage: vi.fn(),
  putConversation: vi.fn(),
  deleteMessage: vi.fn(),
}));

import { store } from "@/store";
import { runTurn, stopTurn } from "../engine/streamRunner";
import {
  upsertConversation,
  addMessage,
  removeConversation,
  evictConversationMessages,
  setActiveConversation,
} from "@/store/slices/aiSlice";
import { login } from "@/store/slices/identitySlice";
import { putMessage } from "@/lib/db/aiConversationStore";

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
  h.runToolCalls = [];
  h.onRunTool = undefined;
  vi.mocked(putMessage).mockClear();
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

describe("turn integrity (audit #11/#12/#94 probes)", () => {
  it("PROBE #11: a zero-output failed turn is NOT persisted (no 400-brick seed)", async () => {
    // Pre-fix: failTurnImmediately wrote the empty error bubble through to IDB;
    // on the next session it re-serialized as {role:"assistant", content:""}
    // and Anthropic 400'd every later send in the conversation.
    const convId = "p11a";
    setup(convId);
    h.needsKey = true;
    await runTurn(convId);
    const assistants = assistantMessages(convId);
    // Redux keeps the actionable bubble for THIS session…
    expect(assistants).toHaveLength(1);
    expect(assistants[0].status).toBe("error");
    // …but nothing is written through.
    expect(putMessage).not.toHaveBeenCalled();
  });

  it("PROBE #11: a provider error before any output is not persisted either", async () => {
    const convId = "p11b";
    setup(convId);
    h.chatScript = [[{ type: "error", message: "401 unauthorized" }]];
    await runTurn(convId);
    const assistants = assistantMessages(convId);
    expect(assistants).toHaveLength(1);
    expect(assistants[0].status).toBe("error");
    expect(putMessage).not.toHaveBeenCalled();
  });

  it("a failed turn that DID stream output is still persisted (partial answers survive)", async () => {
    const convId = "p11c";
    setup(convId);
    h.chatScript = [[{ type: "text", delta: "half an ans" }, { type: "error", message: "connection reset" }]];
    await runTurn(convId);
    expect(putMessage).toHaveBeenCalled();
  });

  it("PROBE #12: the streaming flag is turn-scoped — eviction is refused during the tool phase", async () => {
    const convId = "p12";
    setup(convId);
    store.dispatch(setActiveConversation("some-other-conversation"));
    h.chatScript = [
      [{ type: "tool_call", toolCalls: [{ id: "t1", name: "get_profile", arguments: "{}" }] }, { type: "done" }],
      [{ type: "text", delta: "final" }, { type: "done" }],
    ];
    let streamingDuringTool = false;
    let evictedDuringTool = false;
    h.onRunTool = () => {
      // Pre-fix: finishAssistantMessage cleared the flag before tools ran, so a
      // conversation switch here evicted the in-flight conversation, the tool
      // results were dropped, and IDB kept orphan tool_calls (permanent 400).
      streamingDuringTool = !!store.getState().ai.streamingByConversation[convId];
      store.dispatch(evictConversationMessages(convId)); // simulates the switch
      evictedDuringTool =
        store.getState().ai.messagesByConversation[convId] === undefined;
    };
    await runTurn(convId);
    expect(streamingDuringTool).toBe(true);
    expect(evictedDuringTool).toBe(false);
    // The tool result landed on the message (no orphan tool_calls).
    const a = assistantMessages(convId)[0];
    expect(a.toolResults?.t1).toBeTruthy();
    // The flag clears when the WHOLE turn ends.
    expect(store.getState().ai.streamingByConversation[convId]).toBeUndefined();
  });

  it("PROBE #94: Stop during the tool phase halts remaining tools but stubs every result", async () => {
    const convId = "p94";
    setup(convId);
    h.chatScript = [
      [
        {
          type: "tool_call",
          toolCalls: [
            { id: "t1", name: "get_profile", arguments: "{}" },
            { id: "t2", name: "web_search", arguments: "{}" },
            { id: "t3", name: "web_search", arguments: "{}" },
          ],
        },
        { type: "done" },
      ],
      [{ type: "text", delta: "should never stream" }, { type: "done" }],
    ];
    h.onRunTool = () => stopTurn(convId); // user hits Stop while tool 1 runs
    await runTurn(convId);
    // Pre-fix: all three tools executed (paid web searches kept running) and the
    // loop streamed another provider turn after the abort.
    expect(h.runToolCalls).toHaveLength(1);
    expect(h.chatCalls).toHaveLength(1);
    // Every toolCall still has a result (real or cancelled stub) so the persisted
    // history stays provider-valid.
    const a = assistantMessages(convId)[0];
    expect(a.toolResults?.t1).toBeTruthy();
    expect(a.toolResults?.t2?.output).toMatch(/cancel/i);
    expect(a.toolResults?.t3?.output).toMatch(/cancel/i);
    expect(a.toolResults?.t2?.ok).toBe(false);
    // The stubbed message was persisted (history heals across reload).
    expect(putMessage).toHaveBeenCalled();
    expect(store.getState().ai.streamingByConversation[convId]).toBeUndefined();
  });

  it("PROBE #12: deleting the conversation mid-tool-phase stops the loop", async () => {
    const convId = "p12del";
    setup(convId);
    h.chatScript = [
      [{ type: "tool_call", toolCalls: [{ id: "t1", name: "get_profile", arguments: "{}" }] }, { type: "done" }],
      [{ type: "text", delta: "ghost reply" }, { type: "done" }],
    ];
    h.onRunTool = () => {
      store.dispatch(removeConversation(convId));
    };
    await runTurn(convId);
    // Pre-fix: the loop kept going and streamed a reply into the deleted
    // conversation (with an EMPTY history sent to the provider).
    expect(h.chatCalls).toHaveLength(1);
    expect(store.getState().ai.streamingByConversation[convId]).toBeUndefined();
  });
});
