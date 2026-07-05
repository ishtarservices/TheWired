import type { NostrEvent } from "@thewired/shared-types";

import {
  FEED_CAP,
  feedCleared,
  feedEventsReceived,
  feedHydrated,
  feedSlice,
  feedStatusChanged,
} from "../slices/feedSlice";

function note(id: string, created_at: number): NostrEvent {
  return { id, created_at, kind: 1, pubkey: "p", tags: [], content: id, sig: "s" };
}

const reduce = feedSlice.reducer;

describe("feedSlice", () => {
  it("inserts newest-first and tracks lastSeenAt", () => {
    let state = reduce(undefined, feedEventsReceived([note("a", 100), note("b", 300)]));
    state = reduce(state, feedEventsReceived([note("c", 200)]));

    expect(state.ids).toEqual(["b", "c", "a"]);
    expect(state.lastSeenAt).toBe(300);
  });

  it("dedupes by event id", () => {
    let state = reduce(undefined, feedEventsReceived([note("a", 100)]));
    state = reduce(state, feedEventsReceived([note("a", 100)]));
    expect(state.ids).toEqual(["a"]);
  });

  it("caps the feed and evicts the oldest entities", () => {
    const events = Array.from({ length: FEED_CAP + 20 }, (_, i) => note(`n${i}`, i));
    const state = reduce(undefined, feedEventsReceived(events));

    expect(state.ids).toHaveLength(FEED_CAP);
    expect(state.ids[0]).toBe(`n${FEED_CAP + 19}`); // newest kept
    expect(state.entities["n0"]).toBeUndefined(); // oldest evicted
    expect(Object.keys(state.entities)).toHaveLength(FEED_CAP);
  });

  it("hydration fills the feed and bumps idle → loading", () => {
    const state = reduce(undefined, feedHydrated([note("a", 100)]));
    expect(state.ids).toEqual(["a"]);
    expect(state.status).toBe("loading");
  });

  it("hydration never downgrades a live feed", () => {
    let state = reduce(undefined, feedStatusChanged("live"));
    state = reduce(state, feedHydrated([note("a", 100)]));
    expect(state.status).toBe("live");
  });

  it("clear resets everything", () => {
    let state = reduce(undefined, feedEventsReceived([note("a", 100)]));
    state = reduce(state, feedCleared());
    expect(state.ids).toEqual([]);
    expect(state.lastSeenAt).toBe(0);
    expect(state.status).toBe("idle");
  });
});
