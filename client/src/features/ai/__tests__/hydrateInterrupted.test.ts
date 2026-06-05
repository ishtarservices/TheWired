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
});
