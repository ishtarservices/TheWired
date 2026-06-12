import { describe, it, expect, vi } from "vitest";

// aiContext (imported transitively) loads the store singleton; stub it.
vi.mock("@/store", () => ({ store: { getState: () => ({}), dispatch: vi.fn() } }));

import { messagesToEngineMessages, partsToText } from "../engine/buildEngineMessages";
import type { AIMessage } from "@/types/ai";

function msg(over: Partial<AIMessage> & Pick<AIMessage, "role">): AIMessage {
  return {
    id: "m",
    conversationId: "c1",
    parts: [{ type: "text", text: "" }],
    status: "complete",
    createdAt: 1,
    ...over,
  };
}

describe("messagesToEngineMessages", () => {
  it("passes plain user/assistant turns through and skips system + streaming", () => {
    const out = messagesToEngineMessages([
      msg({ role: "system", parts: [{ type: "text", text: "sys" }] }),
      msg({ role: "user", parts: [{ type: "text", text: "hi" }] }),
      msg({ role: "assistant", parts: [{ type: "text", text: "yo" }] }),
      msg({ role: "assistant", parts: [{ type: "text", text: "partial" }], status: "streaming" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "user" });
    expect(out[1]).toMatchObject({ role: "assistant" });
  });

  it("frames an Ask-AI context as untrusted data before the user's request", () => {
    const out = messagesToEngineMessages([
      msg({
        role: "user",
        parts: [{ type: "text", text: "summarize this" }],
        context: {
          kind: "note",
          label: "Note",
          text: "the note body",
          refs: {},
          defaultInstruction: "",
          trust: "untrusted",
        },
      }),
    ]);
    expect(out).toHaveLength(1);
    const content = out[0].content as string;
    expect(content).toContain("[BEGIN UNTRUSTED NOTE");
    expect(content).toContain("the note body");
    // user's own request comes AFTER the framed block
    expect(content.indexOf("the note body")).toBeLessThan(content.indexOf("summarize this"));
  });

  it("round-trips assistant tool calls + a tool result per call, in order", () => {
    const out = messagesToEngineMessages([
      msg({ role: "user", parts: [{ type: "text", text: "who is alice" }] }),
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        toolCalls: [{ id: "t1", name: "get_profile", arguments: '{"pubkey":"alice"}' }],
        toolResults: { t1: { ok: true, output: "alice is …" } },
      }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "t1", name: "get_profile" }],
    });
    expect(out[2]).toEqual({
      role: "tool",
      toolCallId: "t1",
      name: "get_profile",
      content: "alice is …",
    });
  });

  it("treats an assistant message with empty toolCalls as plain content (cancelled-mid-call)", () => {
    // finalizeAborted clears unresolved toolCalls to [] on cancel; the resent
    // history must then be a normal assistant turn with no dangling tool_calls.
    const out = messagesToEngineMessages([
      msg({ role: "assistant", parts: [{ type: "text", text: "partial answer" }], toolCalls: [] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ role: "assistant" });
    expect(out[0].toolCalls).toBeUndefined();
  });

  it("emits a stub tool result for a call with no stored result (no orphan tool_calls)", () => {
    // Pre-fix this omitted the tool message entirely, leaving an assistant
    // tool_calls message with a missing result — providers reject the whole
    // conversation with a 400 from then on (audit #12). The stub heals
    // already-bricked histories with zero migration.
    const out = messagesToEngineMessages([
      msg({
        role: "assistant",
        parts: [{ type: "text", text: "" }],
        toolCalls: [
          { id: "t1", name: "get_profile", arguments: "{}" },
          { id: "t2", name: "search_notes", arguments: "{}" },
        ],
        toolResults: { t1: { ok: true, output: "done" } },
      }),
    ]);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ role: "tool", toolCallId: "t1", content: "done" });
    expect(out[2]).toMatchObject({ role: "tool", toolCallId: "t2" });
    expect(out[2].content).toMatch(/interrupted|no result/i);
  });
});

describe("provider-history integrity (audit #11/#12 probes)", () => {
  /** Flatten an EngineChatMessage's content for emptiness checks. */
  function flat(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (p && typeof p === "object" && "text" in p ? String(p.text) : ""))
        .join("");
    }
    return "";
  }

  it("PROBE #11: zero-output error bubbles are filtered from provider history", () => {
    // Pre-fix repro: a failed turn (missing key / 401) persisted an assistant
    // message with parts:[] and status:"error"; re-sending it serializes to
    // {role:"assistant", content:""} which Anthropic rejects — bricking the
    // conversation in a compounding 400 loop.
    const out = messagesToEngineMessages([
      msg({ role: "user", parts: [{ type: "text", text: "hi" }] }),
      msg({ role: "assistant", parts: [], status: "error", error: "Add an API key…" }),
      msg({ role: "user", parts: [{ type: "text", text: "retry" }] }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.role === "user")).toBe(true);
  });

  it("PROBE #11: reasoning-only assistant messages are filtered (reasoning is never resent)", () => {
    const out = messagesToEngineMessages([
      msg({ role: "user", parts: [{ type: "text", text: "think" }] }),
      msg({ role: "assistant", parts: [], reasoning: "chain of thought…" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("keeps an empty-text assistant message that carries toolCalls (round-trip contract)", () => {
    const out = messagesToEngineMessages([
      msg({
        role: "assistant",
        parts: [],
        toolCalls: [{ id: "t1", name: "get_profile", arguments: "{}" }],
        toolResults: { t1: { ok: true, output: "x" } },
      }),
    ]);
    expect(out[0]).toMatchObject({ role: "assistant", toolCalls: [{ id: "t1" }] });
  });

  it("PROBE #11/#12: a bricked-history fixture serializes provider-valid", () => {
    // Exactly what the pre-fix code persisted: several empty error bubbles plus
    // an assistant message whose tool loop was wiped mid-turn (toolCalls, no
    // results). The serialized history must contain no empty assistant content
    // and no toolCall without a matching tool result.
    const out = messagesToEngineMessages([
      msg({ role: "user", parts: [{ type: "text", text: "q1" }] }),
      msg({ id: "e1", role: "assistant", parts: [], status: "error", error: "401" }),
      msg({ id: "e2", role: "assistant", parts: [], status: "error", error: "401" }),
      msg({
        id: "orphan",
        role: "assistant",
        parts: [{ type: "text", text: "let me check" }],
        toolCalls: [
          { id: "t1", name: "web_search", arguments: "{}" },
          { id: "t2", name: "get_profile", arguments: "{}" },
        ],
      }),
      msg({ role: "user", parts: [{ type: "text", text: "q2" }] }),
    ]);
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();
    for (const m of out) {
      if (m.role === "assistant") {
        for (const tc of m.toolCalls ?? []) toolCallIds.add(tc.id);
        if (!m.toolCalls?.length) {
          expect(flat(m.content).trim()).not.toBe("");
        }
      }
      if (m.role === "tool" && m.toolCallId) toolResultIds.add(m.toolCallId);
    }
    expect([...toolCallIds].every((id) => toolResultIds.has(id))).toBe(true);
  });
});

describe("partsToText", () => {
  it("concatenates text parts, ignoring non-text", () => {
    expect(
      partsToText([
        { type: "text", text: "a" },
        { type: "image", url: "x", mime: "image/png" },
        { type: "text", text: "b" },
      ]),
    ).toBe("ab");
  });
});
