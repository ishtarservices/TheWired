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

  it("omits a tool message for a call with no result (no orphan tool message)", () => {
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
    // assistant + only the resolved tool result
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ role: "tool", toolCallId: "t1" });
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
