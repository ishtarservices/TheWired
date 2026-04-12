import { describe, it, expect } from "vitest";
import { selectChatMessages } from "../chatSelectors";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { eventsSlice } from "@/store/slices/eventsSlice";
import { spacesSlice } from "@/store/slices/spacesSlice";
import type { NostrEvent } from "@/types/nostr";

const { addEvent, indexChatMessage, hideMessage, indexEditedMessage } =
  eventsSlice.actions;
const { setActiveSpace, setActiveChannel } = spacesSlice.actions;

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-1",
    pubkey: "pk-1",
    created_at: 1000,
    kind: 9,
    tags: [],
    content: "hello",
    sig: "sig-1",
    ...overrides,
  };
}

/**
 * Set up a store with an active space and channel, then index events
 * under the given keys.
 */
function setupStore({
  spaceId = "space-1",
  channelId = "space-1:chat",
  spaceEvents = [] as NostrEvent[],
  channelEvents = [] as NostrEvent[],
}: {
  spaceId?: string;
  channelId?: string | null;
  spaceEvents?: NostrEvent[];
  channelEvents?: NostrEvent[];
} = {}) {
  const store = createTestStore();
  store.dispatch(setActiveSpace(spaceId));
  if (channelId) {
    store.dispatch(setActiveChannel(channelId));
  }

  for (const evt of spaceEvents) {
    store.dispatch(addEvent(evt));
    store.dispatch(indexChatMessage({ groupId: spaceId, eventId: evt.id }));
  }
  for (const evt of channelEvents) {
    store.dispatch(addEvent(evt));
    store.dispatch(indexChatMessage({ groupId: channelId!, eventId: evt.id }));
  }

  return store;
}

describe("selectChatMessages", () => {
  it("returns empty when no active space", () => {
    const store = createTestStore();
    expect(selectChatMessages(store.getState())).toEqual([]);
  });

  it("returns channel-scoped messages when only channel key has events", () => {
    const e1 = makeEvent({ id: "e1", created_at: 100, content: "first" });
    const e2 = makeEvent({ id: "e2", created_at: 200, content: "second" });
    const store = setupStore({ channelEvents: [e1, e2] });

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(2);
    expect(result[0].event.id).toBe("e1");
    expect(result[1].event.id).toBe("e2");
  });

  it("falls back to space-level messages when channel key is empty", () => {
    const e1 = makeEvent({ id: "e1", created_at: 100 });
    const store = setupStore({ spaceEvents: [e1] });

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(1);
    expect(result[0].event.id).toBe("e1");
  });

  // ── Split-indexing regression (the bug this fix addresses) ──

  it("merges events split between space and channel keys", () => {
    // Simulates the race: bg sub indexes under space key before channels load,
    // then channel sub indexes older events under channel key after channels load.
    const bgSubEvent = makeEvent({ id: "recent", created_at: 300, content: "recent from bg sub" });
    const channelSubEvent = makeEvent({ id: "old", created_at: 100, content: "old from channel sub" });

    const store = setupStore({
      spaceEvents: [bgSubEvent],
      channelEvents: [channelSubEvent],
    });

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(2);
    // Sorted by created_at ascending
    expect(result[0].event.id).toBe("old");
    expect(result[1].event.id).toBe("recent");
  });

  it("deduplicates events that appear in both keys", () => {
    const evt = makeEvent({ id: "e1", created_at: 100 });

    const store = setupStore({
      spaceEvents: [evt],
      channelEvents: [evt],
    });

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(1);
  });

  it("merges correctly with many events in both keys", () => {
    const spaceEvents = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `space-${i}`, created_at: 200 + i }),
    );
    const channelEvents = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ id: `channel-${i}`, created_at: 100 + i }),
    );
    // One overlapping event in both keys
    const overlap = makeEvent({ id: "overlap", created_at: 150 });

    const store = setupStore({
      spaceEvents: [...spaceEvents, overlap],
      channelEvents: [...channelEvents, overlap],
    });

    const result = selectChatMessages(store.getState());
    // 5 + 5 + 1 overlap (deduped) = 11
    expect(result).toHaveLength(11);
    // Verify sorted ascending
    for (let i = 1; i < result.length; i++) {
      expect(result[i].event.created_at).toBeGreaterThanOrEqual(
        result[i - 1].event.created_at,
      );
    }
  });

  // ── Existing selector behavior preserved ──

  it("filters out deleted messages", () => {
    const e1 = makeEvent({ id: "e1", created_at: 100 });
    const e2 = makeEvent({ id: "e2", created_at: 200 });
    const store = setupStore({ channelEvents: [e1, e2] });
    store.dispatch(hideMessage("e1"));

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(1);
    expect(result[0].event.id).toBe("e2");
  });

  it("resolves edited messages", () => {
    const original = makeEvent({ id: "orig", created_at: 100, content: "before" });
    const edit = makeEvent({ id: "edit", created_at: 200, content: "after" });
    const store = setupStore({ channelEvents: [original] });
    store.dispatch(addEvent(edit));
    store.dispatch(indexEditedMessage({ originalId: "orig", editEventId: "edit" }));

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(1);
    expect(result[0].isEdited).toBe(true);
    expect(result[0].displayContent).toBe("after");
  });

  it("works with no active channel (space-level only)", () => {
    const e1 = makeEvent({ id: "e1", created_at: 100 });
    const store = setupStore({ channelId: null, spaceEvents: [e1] });
    // Clear active channel
    store.dispatch(setActiveChannel(null));

    const result = selectChatMessages(store.getState());
    expect(result).toHaveLength(1);
  });

  it("sorts messages by created_at ascending", () => {
    const events = [
      makeEvent({ id: "e3", created_at: 300 }),
      makeEvent({ id: "e1", created_at: 100 }),
      makeEvent({ id: "e2", created_at: 200 }),
    ];
    const store = setupStore({ channelEvents: events });

    const result = selectChatMessages(store.getState());
    expect(result.map((m) => m.event.id)).toEqual(["e1", "e2", "e3"]);
  });
});
