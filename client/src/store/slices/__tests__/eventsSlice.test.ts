import { describe, it, expect } from "vitest";
import { eventsSlice, eventsSelectors } from "../eventsSlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import type { NostrEvent } from "@/types/nostr";

const {
  addEvent,
  addEvents,
  removeEvent,
  indexChatMessage,
  indexSpaceFeed,
  indexNote,
  indexReaction,
  indexReply,
  indexRepost,
  indexQuote,
  hideMessage,
  removeChatMessage,
  indexEditedMessage,
  trackDeletedNote,
  trackDeletedAddr,
  clearSpaceFeed,
} = eventsSlice.actions;

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-1",
    pubkey: "pk-1",
    created_at: 1000000,
    kind: 1,
    tags: [],
    content: "test",
    sig: "sig-1",
    ...overrides,
  };
}

describe("eventsSlice", () => {
  // ─── Entity adapter basics ─────────────────────

  it("adds an event via addEvent", () => {
    const store = createTestStore();
    const event = makeEvent();
    store.dispatch(addEvent(event));
    const stored = eventsSelectors.selectById(store.getState().events, "evt-1");
    expect(stored).toBeDefined();
    expect(stored!.content).toBe("test");
  });

  it("upserts on duplicate addEvent", () => {
    const store = createTestStore();
    store.dispatch(addEvent(makeEvent({ content: "v1" })));
    store.dispatch(addEvent(makeEvent({ content: "v2" })));
    const stored = eventsSelectors.selectById(store.getState().events, "evt-1");
    expect(stored!.content).toBe("v2");
  });

  it("adds multiple events via addEvents", () => {
    const store = createTestStore();
    store.dispatch(
      addEvents([makeEvent({ id: "e1" }), makeEvent({ id: "e2" })]),
    );
    expect(eventsSelectors.selectAll(store.getState().events)).toHaveLength(2);
  });

  it("removes an event", () => {
    const store = createTestStore();
    store.dispatch(addEvent(makeEvent()));
    store.dispatch(removeEvent("evt-1"));
    expect(
      eventsSelectors.selectById(store.getState().events, "evt-1"),
    ).toBeUndefined();
  });

  // ─── indexChatMessage ──────────────────────────

  it("indexes a chat message by groupId", () => {
    const store = createTestStore();
    store.dispatch(indexChatMessage({ groupId: "g1", eventId: "evt-1" }));
    expect(store.getState().events.chatMessages["g1"]).toEqual(["evt-1"]);
  });

  it("deduplicates chat message index", () => {
    const store = createTestStore();
    store.dispatch(indexChatMessage({ groupId: "g1", eventId: "evt-1" }));
    store.dispatch(indexChatMessage({ groupId: "g1", eventId: "evt-1" }));
    expect(store.getState().events.chatMessages["g1"]).toHaveLength(1);
  });

  // ─── indexSpaceFeed ────────────────────────────

  it("indexes space feed events", () => {
    const store = createTestStore();
    store.dispatch(
      indexSpaceFeed({ contextId: "space:notes", eventId: "evt-1" }),
    );
    expect(store.getState().events.spaceFeeds["space:notes"]).toEqual(["evt-1"]);
  });

  it("caps space feed at 500 entries", () => {
    const store = createTestStore();
    // Add 501 events
    for (let i = 0; i < 501; i++) {
      store.dispatch(
        indexSpaceFeed({ contextId: "space:notes", eventId: `evt-${i}` }),
      );
    }
    const feed = store.getState().events.spaceFeeds["space:notes"];
    expect(feed.length).toBeLessThanOrEqual(500);
  });

  it("clears space feed", () => {
    const store = createTestStore();
    store.dispatch(
      indexSpaceFeed({ contextId: "space:notes", eventId: "evt-1" }),
    );
    store.dispatch(clearSpaceFeed("space:notes"));
    expect(store.getState().events.spaceFeeds["space:notes"]).toBeUndefined();
  });

  // ─── indexNote ─────────────────────────────────

  it("indexes notes by author pubkey", () => {
    const store = createTestStore();
    store.dispatch(indexNote({ pubkey: "pk-1", eventId: "evt-1" }));
    expect(store.getState().events.notesByAuthor["pk-1"]).toEqual(["evt-1"]);
  });

  // ─── indexReaction / indexReply / indexRepost ───

  it("indexes reactions by target event", () => {
    const store = createTestStore();
    store.dispatch(
      indexReaction({ targetEventId: "target-1", eventId: "rxn-1" }),
    );
    expect(store.getState().events.reactions["target-1"]).toEqual(["rxn-1"]);
  });

  it("indexes replies by parent event", () => {
    const store = createTestStore();
    store.dispatch(
      indexReply({ parentEventId: "parent-1", eventId: "reply-1" }),
    );
    expect(store.getState().events.replies["parent-1"]).toEqual(["reply-1"]);
  });

  it("indexes reposts by target event", () => {
    const store = createTestStore();
    store.dispatch(
      indexRepost({ targetEventId: "target-1", eventId: "repost-1" }),
    );
    expect(store.getState().events.reposts["target-1"]).toEqual(["repost-1"]);
  });

  it("indexes quotes by target event", () => {
    const store = createTestStore();
    store.dispatch(
      indexQuote({ targetEventId: "target-1", eventId: "quote-1" }),
    );
    expect(store.getState().events.quotes["target-1"]).toEqual(["quote-1"]);
  });

  // ─── Deletion tracking ────────────────────────

  it("hides a message (local deletion)", () => {
    const store = createTestStore();
    store.dispatch(hideMessage("evt-1"));
    expect(store.getState().events.deletedMessageIds["evt-1"]).toBe(true);
  });

  it("tracks deleted note IDs (kind:5)", () => {
    const store = createTestStore();
    store.dispatch(trackDeletedNote("evt-1"));
    expect(store.getState().events.deletedNoteIds["evt-1"]).toBe(true);
  });

  it("tracks deleted addressable IDs with max timestamp", () => {
    const store = createTestStore();
    store.dispatch(trackDeletedAddr({ addr: "30023:pk:slug", deletedAt: 100 }));
    expect(store.getState().events.deletedAddrIds["30023:pk:slug"]).toBe(100);
    // Higher timestamp overwrites
    store.dispatch(trackDeletedAddr({ addr: "30023:pk:slug", deletedAt: 200 }));
    expect(store.getState().events.deletedAddrIds["30023:pk:slug"]).toBe(200);
    // Lower timestamp does not overwrite
    store.dispatch(trackDeletedAddr({ addr: "30023:pk:slug", deletedAt: 50 }));
    expect(store.getState().events.deletedAddrIds["30023:pk:slug"]).toBe(200);
  });

  // ─── removeChatMessage ─────────────────────────

  it("removes a chat message from index", () => {
    const store = createTestStore();
    store.dispatch(indexChatMessage({ groupId: "g1", eventId: "evt-1" }));
    store.dispatch(indexChatMessage({ groupId: "g1", eventId: "evt-2" }));
    store.dispatch(removeChatMessage({ contextId: "g1", eventId: "evt-1" }));
    expect(store.getState().events.chatMessages["g1"]).toEqual(["evt-2"]);
  });

  // ─── indexEditedMessage ────────────────────────

  it("maps original event to edit event", () => {
    const store = createTestStore();
    store.dispatch(
      indexEditedMessage({ originalId: "orig-1", editEventId: "edit-1" }),
    );
    expect(store.getState().events.editedMessages["orig-1"]).toBe("edit-1");
  });

  it("overwrites edit mapping with newer edit", () => {
    const store = createTestStore();
    store.dispatch(
      indexEditedMessage({ originalId: "orig-1", editEventId: "edit-1" }),
    );
    store.dispatch(
      indexEditedMessage({ originalId: "orig-1", editEventId: "edit-2" }),
    );
    expect(store.getState().events.editedMessages["orig-1"]).toBe("edit-2");
  });
});
