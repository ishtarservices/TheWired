import { describe, it, expect } from "vitest";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import {
  upsertConversation,
  addMessage,
  startAssistantMessage,
  appendAssistantDelta,
  finishAssistantMessage,
  failAssistantMessage,
  removeConversation,
  setConversationMessages,
  addArtifact,
  upsertProviderConfig,
  removeProviderConfig,
  selectMessageIdsForConversation,
  selectIsStreaming,
} from "@/store/slices/aiSlice";
import type { AIConversation, AIMessage } from "@/types/ai";

function convo(id: string, t = 1): AIConversation {
  return {
    id,
    title: "New chat",
    providerId: null,
    model: null,
    createdAt: t,
    updatedAt: t,
  };
}
function userMsg(id: string, conversationId: string, createdAt: number): AIMessage {
  return {
    id,
    conversationId,
    role: "user",
    parts: [{ type: "text", text: "hi" }],
    status: "complete",
    createdAt,
  };
}

describe("aiSlice", () => {
  it("indexes messages per conversation and bumps updatedAt", () => {
    const store = createTestStore();
    store.dispatch(upsertConversation(convo("c1")));
    store.dispatch(addMessage({ message: userMsg("m1", "c1", 2), bumpUpdatedAt: 2 }));
    expect(selectMessageIdsForConversation("c1")(store.getState())).toEqual(["m1"]);
    expect(store.getState().ai.conversations.entities["c1"]?.updatedAt).toBe(2);
  });

  it("runs the streaming lifecycle: start → append → finish", () => {
    const store = createTestStore();
    store.dispatch(upsertConversation(convo("c1")));
    store.dispatch(startAssistantMessage({ conversationId: "c1", messageId: "a1", createdAt: 3 }));
    expect(selectIsStreaming("c1")(store.getState())).toBe(true);

    store.dispatch(appendAssistantDelta({ messageId: "a1", text: "Hel" }));
    store.dispatch(appendAssistantDelta({ messageId: "a1", text: "lo" }));
    expect(store.getState().ai.messages.entities["a1"]?.parts).toEqual([
      { type: "text", text: "Hello" },
    ]);

    store.dispatch(finishAssistantMessage({ conversationId: "c1", messageId: "a1" }));
    expect(selectIsStreaming("c1")(store.getState())).toBe(false);
    expect(store.getState().ai.messages.entities["a1"]?.status).toBe("complete");
  });

  it("marks a failed turn and clears the streaming flag", () => {
    const store = createTestStore();
    store.dispatch(upsertConversation(convo("c1")));
    store.dispatch(startAssistantMessage({ conversationId: "c1", messageId: "a1", createdAt: 3 }));
    store.dispatch(failAssistantMessage({ conversationId: "c1", messageId: "a1", error: "boom" }));
    expect(selectIsStreaming("c1")(store.getState())).toBe(false);
    const m = store.getState().ai.messages.entities["a1"];
    expect(m?.status).toBe("error");
    expect(m?.error).toBe("boom");
  });

  it("cascade-deletes messages + artifacts + index on removeConversation", () => {
    const store = createTestStore();
    store.dispatch(upsertConversation(convo("c1")));
    store.dispatch(addMessage({ message: userMsg("m1", "c1", 2) }));
    store.dispatch(
      addArtifact({
        id: "art1",
        conversationId: "c1",
        sourceMessageId: "m1",
        type: "code",
        title: "x",
        content: "y",
        createdAt: 4,
      }),
    );
    store.dispatch(removeConversation("c1"));
    const s = store.getState().ai;
    expect(s.conversations.entities["c1"]).toBeUndefined();
    expect(s.messages.entities["m1"]).toBeUndefined();
    expect(s.messagesByConversation["c1"]).toBeUndefined();
    expect(s.artifacts["art1"]).toBeUndefined();
  });

  it("hydrates messages sorted by createdAt", () => {
    const store = createTestStore();
    store.dispatch(
      setConversationMessages({
        conversationId: "c2",
        messages: [userMsg("x2", "c2", 20), userMsg("x1", "c2", 10)],
      }),
    );
    expect(selectMessageIdsForConversation("c2")(store.getState())).toEqual(["x1", "x2"]);
    expect(store.getState().ai.hydratedConversations).toContain("c2");
  });

  it("adds and removes provider configs (display state only)", () => {
    const store = createTestStore();
    store.dispatch(
      upsertProviderConfig({
        id: "p1",
        kind: "openai-compat",
        label: "Local",
        baseUrl: "http://localhost:11434/v1",
        keyRequired: false,
      }),
    );
    expect(store.getState().ai.providers["p1"]?.label).toBe("Local");
    store.dispatch(removeProviderConfig("p1"));
    expect(store.getState().ai.providers["p1"]).toBeUndefined();
  });
});
