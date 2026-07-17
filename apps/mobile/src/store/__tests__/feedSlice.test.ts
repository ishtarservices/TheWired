import type { NostrEvent } from "@thewired/shared-types";

import {
  FEED_CAP,
  feedCleared,
  feedContextSwitched,
  feedEventsReceived,
  feedHydrated,
  feedSlice,
  feedStatusChanged,
  selectActiveFeed,
  selectFeedContext,
  selectFeedEvent,
} from "../slices/feedSlice";

function note(id: string, created_at: number): NostrEvent {
  return { id, created_at, kind: 1, pubkey: "p", tags: [], content: id, sig: "s" };
}

const reduce = feedSlice.reducer;

function global(events: NostrEvent[]) {
  return feedEventsReceived({ context: "global", events });
}
function follows(events: NostrEvent[]) {
  return feedEventsReceived({ context: "follows", events });
}

describe("feedSlice", () => {
  it("inserts newest-first and tracks lastSeenAt", () => {
    let state = reduce(undefined, global([note("a", 100), note("b", 300)]));
    state = reduce(state, global([note("c", 200)]));

    expect(state.byContext.global.ids).toEqual(["b", "c", "a"]);
    expect(state.byContext.global.lastSeenAt).toBe(300);
  });

  it("dedupes by event id", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, global([note("a", 100)]));
    expect(state.byContext.global.ids).toEqual(["a"]);
  });

  it("caps each context and evicts the oldest entities", () => {
    const events = Array.from({ length: FEED_CAP + 20 }, (_, i) => note(`n${i}`, i));
    const state = reduce(undefined, global(events));

    expect(state.byContext.global.ids).toHaveLength(FEED_CAP);
    expect(state.byContext.global.ids[0]).toBe(`n${FEED_CAP + 19}`); // newest kept
    expect(state.byContext.global.entities["n0"]).toBeUndefined(); // oldest evicted
    expect(Object.keys(state.byContext.global.entities)).toHaveLength(FEED_CAP);
  });

  it("hydration fills the feed and bumps idle → loading", () => {
    const state = reduce(undefined, feedHydrated({ context: "global", events: [note("a", 100)] }));
    expect(state.byContext.global.ids).toEqual(["a"]);
    expect(state.byContext.global.status).toBe("loading");
  });

  it("hydration never downgrades a live feed", () => {
    let state = reduce(undefined, feedStatusChanged({ context: "global", status: "live" }));
    state = reduce(state, feedHydrated({ context: "global", events: [note("a", 100)] }));
    expect(state.byContext.global.status).toBe("live");
  });

  it("clear with no payload resets every context", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, follows([note("b", 200)]));
    state = reduce(state, feedCleared());
    expect(state.byContext.global.ids).toEqual([]);
    expect(state.byContext.follows.ids).toEqual([]);
    expect(state.byContext.global.lastSeenAt).toBe(0);
    expect(state.byContext.global.status).toBe("idle");
  });

  it("keeps contexts isolated — follows events never touch the global bucket", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, follows([note("b", 300)]));

    expect(state.byContext.global.ids).toEqual(["a"]);
    expect(state.byContext.follows.ids).toEqual(["b"]);
    expect(state.byContext.global.lastSeenAt).toBe(100);
    expect(state.byContext.follows.lastSeenAt).toBe(300);
  });

  it("advances lastSeenAt independently per context", () => {
    let state = reduce(undefined, global([note("a", 500)]));
    state = reduce(state, follows([note("b", 100)]));
    expect(state.byContext.global.lastSeenAt).toBe(500);
    expect(state.byContext.follows.lastSeenAt).toBe(100);
  });

  it("switches the active context without touching buckets", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, feedContextSwitched("follows"));
    expect(selectFeedContext({ feed: state })).toBe("follows");
    expect(state.byContext.global.ids).toEqual(["a"]);
    expect(selectActiveFeed({ feed: state }).ids).toEqual([]);
  });

  it("clears one context without touching the other", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, follows([note("b", 200)]));
    state = reduce(state, feedCleared({ context: "follows" }));
    expect(state.byContext.global.ids).toEqual(["a"]);
    expect(state.byContext.follows.ids).toEqual([]);
    expect(state.byContext.follows.lastSeenAt).toBe(0);
  });

  it("caps the follows context independently", () => {
    const events = Array.from({ length: FEED_CAP + 5 }, (_, i) => note(`f${i}`, i));
    let state = reduce(undefined, follows(events));
    state = reduce(state, global([note("g", 1)]));
    expect(state.byContext.follows.ids).toHaveLength(FEED_CAP);
    expect(state.byContext.global.ids).toEqual(["g"]);
  });

  it("keeps accepting live events regardless of what the view renders (freeze contract)", () => {
    // The freeze layer is view-only: while a screen renders a frozen snapshot,
    // batches keep landing in the slice and lastSeenAt keeps advancing.
    let state = reduce(undefined, global([note("a", 100)]));
    for (let i = 0; i < 5; i++) {
      state = reduce(state, global([note(`live${i}`, 200 + i)]));
    }
    expect(state.byContext.global.ids).toHaveLength(6);
    expect(state.byContext.global.lastSeenAt).toBe(204);
  });

  it("selectFeedEvent finds entities across contexts", () => {
    let state = reduce(undefined, global([note("a", 100)]));
    state = reduce(state, follows([note("b", 200)]));
    expect(selectFeedEvent({ feed: state }, "a")?.id).toBe("a");
    expect(selectFeedEvent({ feed: state }, "b")?.id).toBe("b");
    expect(selectFeedEvent({ feed: state }, "zzz")).toBeUndefined();
  });
});
