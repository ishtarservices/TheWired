import {
  channelKey,
  channelMarkedRead,
  channelPreviewsUpserted,
  selectChannelPreview,
  selectChannelUnreadCount,
  selectSpaceMusicArtwork,
  spaceLastReadHydrated,
  spaceMusicArtworkSeen,
  spacePreviewsCleared,
  spacePreviewsSlice,
  type ChannelMessageSeen,
} from "../slices/spacePreviewsSlice";

type SliceState = ReturnType<typeof spacePreviewsSlice.reducer>;

const reduce = (state: SliceState | undefined, action: Parameters<typeof spacePreviewsSlice.reducer>[1]) =>
  spacePreviewsSlice.reducer(state, action);

const wrap = (spacePreviews: SliceState) => ({ spacePreviews });

let seq = 0;
const seen = (over: Partial<ChannelMessageSeen> = {}): ChannelMessageSeen => ({
  spaceId: "s1",
  channelId: "general",
  eventId: `ev${seq++}`,
  createdAt: 100,
  senderPubkey: "a".repeat(64),
  content: "hello there",
  isOwn: false,
  ...over,
});

const msg = (over: Partial<ChannelMessageSeen> = {}) =>
  channelPreviewsUpserted([seen(over)]);

describe("spacePreviewsSlice", () => {
  it("upserts a preview and keeps the newest message", () => {
    let state = reduce(undefined, msg({ createdAt: 100, content: "first" }));
    state = reduce(state, msg({ createdAt: 90, content: "older" }));
    const preview = selectChannelPreview(wrap(state), "s1", "general")!;
    expect(preview.lastText).toBe("first");
    expect(preview.lastEventAt).toBe(100);
    expect(preview.entries.map((e) => e.at)).toEqual(expect.arrayContaining([90, 100]));
  });

  it("applies a whole batch in one action", () => {
    const state = reduce(
      undefined,
      channelPreviewsUpserted([
        seen({ createdAt: 100, content: "one" }),
        seen({ createdAt: 200, content: "two" }),
        seen({ channelId: "dev", createdAt: 50, content: "elsewhere" }),
      ]),
    );
    expect(selectChannelPreview(wrap(state), "s1", "general")!.lastText).toBe("two");
    expect(selectChannelPreview(wrap(state), "s1", "dev")!.lastText).toBe("elsewhere");
  });

  it("dedups by event id — signal sub + open chat socket double delivery", () => {
    let state = reduce(undefined, msg({ eventId: "dup", createdAt: 100 }));
    state = reduce(state, msg({ eventId: "dup", createdAt: 100 }));
    expect(selectChannelPreview(wrap(state), "s1", "general")!.entries).toHaveLength(1);
  });

  it("counts two distinct messages in the same second", () => {
    let state = reduce(undefined, msg({ eventId: "e1", createdAt: 100 }));
    state = reduce(state, msg({ eventId: "e2", createdAt: 100 }));
    state = reduce(state, channelMarkedRead({ spaceId: "s1", channelId: "general", at: 50 }));
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(2);
  });

  it("own messages update the preview line but never count unread", () => {
    let state = reduce(state0(), channelMarkedRead({ spaceId: "s1", channelId: "general", at: 50 }));
    state = reduce(state, msg({ createdAt: 100, content: "theirs" }));
    state = reduce(state, msg({ createdAt: 200, content: "mine", isOwn: true }));
    const preview = selectChannelPreview(wrap(state), "s1", "general")!;
    expect(preview.lastText).toBe("mine");
    expect(preview.lastEventAt).toBe(200);
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(1);
  });

  it("a channel created by an own message reports 0 unread", () => {
    let state = reduce(undefined, channelMarkedRead({ spaceId: "s1", channelId: "general", at: 50 }));
    state = reduce(state, msg({ createdAt: 100, isOwn: true }));
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(0);
  });

  it("truncates long previews to one line", () => {
    const state = reduce(undefined, msg({ content: `line\none ${"x".repeat(100)}` }));
    const preview = selectChannelPreview(wrap(state), "s1", "general")!;
    expect(preview.lastText).not.toContain("\n");
    expect(preview.lastText.length).toBeLessThanOrEqual(61);
    expect(preview.lastText.endsWith("…")).toBe(true);
  });

  it("bounds the per-channel entry list, keeping the newest", () => {
    let state: SliceState | undefined;
    for (let i = 0; i < 150; i++) {
      state = reduce(state, msg({ createdAt: 1000 + i, content: `m${i}` }));
    }
    const preview = selectChannelPreview(wrap(state!), "s1", "general")!;
    expect(preview.entries.length).toBeLessThanOrEqual(100);
    expect(preview.lastEventAt).toBe(1149);
    expect(preview.entries.some((e) => e.at === 1149)).toBe(true);
  });

  it("reports 0 unread for channels never opened (unknown is not unread)", () => {
    const state = reduce(undefined, msg({ createdAt: 100 }));
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(0);
  });

  it("counts only messages newer than lastReadAt; marking read zeroes it", () => {
    let state = reduce(undefined, msg({ createdAt: 100 }));
    state = reduce(state, msg({ createdAt: 200, content: "next" }));
    state = reduce(state, channelMarkedRead({ spaceId: "s1", channelId: "general", at: 150 }));
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(1);
    state = reduce(state, channelMarkedRead({ spaceId: "s1", channelId: "general", at: 250 }));
    expect(selectChannelUnreadCount(wrap(state), "s1", "general")).toBe(0);
  });

  it("mark-read never moves backwards", () => {
    let state = reduce(undefined, channelMarkedRead({ spaceId: "s1", channelId: "c", at: 200 }));
    state = reduce(state, channelMarkedRead({ spaceId: "s1", channelId: "c", at: 100 }));
    expect(state.lastReadAt[channelKey("s1", "c")]).toBe(200);
  });

  it("hydration merges by max so racing mark-reads win", () => {
    let state = reduce(undefined, channelMarkedRead({ spaceId: "s1", channelId: "c", at: 300 }));
    state = reduce(state, spaceLastReadHydrated({ [channelKey("s1", "c")]: 100, other: 50 }));
    expect(state.lastReadAt[channelKey("s1", "c")]).toBe(300);
    expect(state.lastReadAt.other).toBe(50);
    expect(state.lastReadHydrated).toBe(true);
  });

  it("caps stored artwork at 8 and ignores empty updates", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://cdn.example/${i}.jpg`);
    let state = reduce(undefined, spaceMusicArtworkSeen({ spaceId: "s1", artworks: urls }));
    expect(selectSpaceMusicArtwork(wrap(state), "s1")).toHaveLength(8);
    state = reduce(state, spaceMusicArtworkSeen({ spaceId: "s1", artworks: [] }));
    expect(selectSpaceMusicArtwork(wrap(state), "s1")).toHaveLength(8);
  });

  it("returns a stable empty artwork list for unknown spaces", () => {
    const state = reduce(undefined, { type: "noop" });
    expect(selectSpaceMusicArtwork(wrap(state), "a")).toBe(
      selectSpaceMusicArtwork(wrap(state), "b"),
    );
  });

  it("clears everything on logout/account switch", () => {
    let state = reduce(undefined, msg());
    state = reduce(state, channelMarkedRead({ spaceId: "s1", channelId: "general", at: 1 }));
    state = reduce(state, spacePreviewsCleared());
    expect(state.previews).toEqual({});
    expect(state.lastReadAt).toEqual({});
    expect(state.lastReadHydrated).toBe(false);
  });
});

function state0(): SliceState {
  return spacePreviewsSlice.reducer(undefined, { type: "noop" });
}
