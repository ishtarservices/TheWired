import { describe, it, expect, vi } from "vitest";
import type { AIMessage } from "@/types/ai";

// hydrateConversation pulls messages from IDB and (transitively) imports the
// engine + artifact sync; stub those seams so the test is about the recovery.
const h = vi.hoisted(() => ({ messages: [] as AIMessage[] }));

vi.mock("@/lib/db/aiConversationStore", () => ({
  getMessagesForConversation: async () => h.messages,
  getConversationsForAccount: async () => [],
  putConversation: vi.fn(),
  putMessage: vi.fn(),
  deleteConversation: vi.fn(),
  deleteMessage: vi.fn(),
}));
vi.mock("../engine/streamRunner", () => ({ runTurn: vi.fn() }));
vi.mock("../artifacts/artifactSync", () => ({ syncArtifactsForMessage: vi.fn() }));

import { store } from "@/store";
import { hydrateConversation } from "../conversationActions";
import { deleteMessage } from "@/lib/db/aiConversationStore";

describe("hydrateConversation — interrupted-stream recovery", () => {
  it("surfaces a leftover 'streaming' message as a complete bubble (no data loss)", async () => {
    const convId = "conv-interrupted";
    h.messages = [
      {
        id: "a1",
        conversationId: convId,
        role: "assistant",
        parts: [{ type: "text", text: "a long partial answer" }],
        status: "streaming", // checkpoint from a generation cut off by reload
        createdAt: 5,
      },
    ];

    await hydrateConversation(convId);

    const m = store.getState().ai.messages.entities["a1"];
    expect(m).toBeDefined();
    expect(m!.status).toBe("complete"); // not stuck on a spinner
    expect(m!.parts.map((p) => (p.type === "text" ? p.text : "")).join("")).toBe(
      "a long partial answer",
    ); // partial text preserved
  });

  it("PROBE #11: scrubs persisted zero-output error bubbles and deletes the stored junk", async () => {
    // Pre-fix builds persisted empty error bubbles; each one re-serializes as
    // empty assistant content and 400s the conversation. The scrub heals
    // conversations bricked before the fix — permanently, by deleting the rows.
    const convId = "conv-bricked";
    h.messages = [
      {
        id: "junk1",
        conversationId: convId,
        role: "assistant",
        parts: [],
        status: "error",
        error: "Add an API key…",
        createdAt: 1,
      },
      {
        id: "junk2",
        conversationId: convId,
        role: "assistant",
        parts: [{ type: "text", text: "   " }],
        status: "error",
        error: "401",
        createdAt: 2,
      },
      {
        id: "keep-reasoning",
        conversationId: convId,
        role: "assistant",
        parts: [],
        reasoning: "thought about it", // renders collapsed — not junk
        status: "complete",
        createdAt: 3,
      },
      {
        id: "keep-text",
        conversationId: convId,
        role: "assistant",
        parts: [{ type: "text", text: "a real answer" }],
        status: "complete",
        createdAt: 4,
      },
    ];

    await hydrateConversation(convId);

    const s = store.getState().ai;
    expect(s.messages.entities["junk1"]).toBeUndefined();
    expect(s.messages.entities["junk2"]).toBeUndefined();
    expect(s.messages.entities["keep-reasoning"]).toBeDefined();
    expect(s.messages.entities["keep-text"]).toBeDefined();
    expect(s.messagesByConversation[convId]).toEqual(["keep-reasoning", "keep-text"]);
    expect(vi.mocked(deleteMessage)).toHaveBeenCalledWith("junk1");
    expect(vi.mocked(deleteMessage)).toHaveBeenCalledWith("junk2");
  });
});
