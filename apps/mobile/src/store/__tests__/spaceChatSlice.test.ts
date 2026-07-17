import type { NostrEvent } from "@thewired/shared-types";

import {
  MAX_CHANNEL_MESSAGES,
  channelBacklogHydrated,
  chatMessageReceived,
  compareChatEvents,
  selectChannelHydrated,
  selectChannelMessages,
  spaceBacklogPurged,
  spaceChatCleared,
  spaceChatSlice,
} from "../slices/spaceChatSlice";

type SliceState = ReturnType<typeof spaceChatSlice.reducer>;

const reduce = (
  state: SliceState | undefined,
  action: Parameters<typeof spaceChatSlice.reducer>[1],
) => spaceChatSlice.reducer(state, action);

const wrap = (spaceChat: SliceState) => ({ spaceChat });

const evt = (id: string, createdAt: number): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  created_at: createdAt,
  kind: 9,
  tags: [["h", "s1"]],
  content: `msg ${id}`,
  sig: "f".repeat(128),
});

const received = (event: NostrEvent, over: { spaceId?: string; channelId?: string } = {}) =>
  chatMessageReceived({ spaceId: "s1", channelId: "general", ...over, event });

describe("spaceChatSlice", () => {
  it("inserts ascending, dedups by id, and caps the channel list", () => {
    let state = reduce(undefined, received(evt("b", 200)));
    state = reduce(state, received(evt("a", 100)));
    state = reduce(state, received(evt("a", 100))); // duplicate id
    expect(selectChannelMessages(wrap(state), "s1", "general").map((e) => e.id)).toEqual([
      "a",
      "b",
    ]);

    for (let i = 0; i < MAX_CHANNEL_MESSAGES + 20; i++) {
      state = reduce(state, received(evt(`m${String(i).padStart(4, "0")}`, 1000 + i)));
    }
    const list = selectChannelMessages(wrap(state), "s1", "general");
    expect(list.length).toBe(MAX_CHANNEL_MESSAGES);
    // Oldest evicted — the newest survive.
    expect(list[list.length - 1].created_at).toBe(1000 + MAX_CHANNEL_MESSAGES + 19);
  });

  it("orders deterministically: hydrate-then-live equals live-then-hydrate", () => {
    // Includes an equal-created_at pair so the id tiebreak is exercised.
    const stored = [evt("s-old", 100), evt("tie-a", 150)];
    const live = [evt("tie-b", 150), evt("l-new", 200)];

    let a: SliceState | undefined;
    a = reduce(a, channelBacklogHydrated({ spaceId: "s1", channelId: "general", events: stored }));
    for (const e of live) a = reduce(a, received(e));

    let b: SliceState | undefined;
    for (const e of live) b = reduce(b, received(e));
    b = reduce(b, channelBacklogHydrated({ spaceId: "s1", channelId: "general", events: stored }));

    const idsA = selectChannelMessages(wrap(a!), "s1", "general").map((e) => e.id);
    const idsB = selectChannelMessages(wrap(b!), "s1", "general").map((e) => e.id);
    expect(idsA).toEqual(idsB);
    expect(idsA).toEqual(["s-old", "tie-a", "tie-b", "l-new"]);
  });

  it("hydration merges without clobbering live events; empty rows still hydrate", () => {
    let state = reduce(undefined, received(evt("live", 300)));
    state = reduce(
      state,
      channelBacklogHydrated({ spaceId: "s1", channelId: "general", events: [evt("old", 100)] }),
    );
    expect(selectChannelMessages(wrap(state), "s1", "general").map((e) => e.id)).toEqual([
      "old",
      "live",
    ]);
    expect(selectChannelHydrated(wrap(state), "s1", "general")).toBe(true);

    let fresh = reduce(
      undefined,
      channelBacklogHydrated({ spaceId: "s2", channelId: "c", events: [] }),
    );
    expect(selectChannelHydrated(wrap(fresh), "s2", "c")).toBe(true);
    expect(selectChannelMessages(wrap(fresh), "s2", "c")).toEqual([]);
  });

  it("purges only the given space's channels", () => {
    let state = reduce(undefined, received(evt("a", 100)));
    state = reduce(state, received(evt("b", 100), { spaceId: "s2", channelId: "general" }));
    state = reduce(
      state,
      channelBacklogHydrated({ spaceId: "s1", channelId: "general", events: [] }),
    );
    state = reduce(state, spaceBacklogPurged("s1"));
    expect(selectChannelMessages(wrap(state), "s1", "general")).toEqual([]);
    expect(selectChannelHydrated(wrap(state), "s1", "general")).toBe(false);
    expect(selectChannelMessages(wrap(state), "s2", "general").map((e) => e.id)).toEqual(["b"]);
  });

  it("clears everything on identity change", () => {
    let state = reduce(undefined, received(evt("a", 100)));
    state = reduce(state, spaceChatCleared());
    expect(selectChannelMessages(wrap(state), "s1", "general")).toEqual([]);
    expect(selectChannelHydrated(wrap(state), "s1", "general")).toBe(false);
  });

  it("returns a stable empty reference for unknown channels", () => {
    const state = reduce(undefined, spaceChatCleared());
    const first = selectChannelMessages(wrap(state), "sX", "c");
    const second = selectChannelMessages(wrap(state), "sY", "c");
    expect(first).toBe(second);
  });

  it("compareChatEvents tiebreaks equal timestamps by id", () => {
    expect(compareChatEvents(evt("a", 100), evt("b", 100))).toBeLessThan(0);
    expect(compareChatEvents(evt("b", 100), evt("a", 100))).toBeGreaterThan(0);
    expect(compareChatEvents(evt("a", 100), evt("a", 100))).toBe(0);
  });
});
