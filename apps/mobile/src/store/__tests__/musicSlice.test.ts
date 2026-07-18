import {
  musicSlice,
  itemsUpserted,
  queueLoaded,
  mirrorTrackChanged,
  mirrorStatusChanged,
  playbackEnded,
  playerErrored,
  repeatSet,
  shuffleApplied,
  musicCleared,
  shuffleOrder,
  selectCurrentItem,
  selectIsCurrent,
  selectQueueIds,
} from "../slices/musicSlice";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const reducer = musicSlice.reducer;
const initial = () => reducer(undefined, { type: "@@INIT" });

const ev = (id: string, createdAt: number): NostrEvent => ({
  id,
  pubkey: "p".repeat(64),
  created_at: createdAt,
  kind: 31683,
  tags: [],
  content: "",
  sig: "",
});

const item = (addressableId: string, createdAt = 1): MusicItem => ({
  id: addressableId,
  event: ev(addressableId, createdAt),
  kind: "track",
  addressableId,
  title: addressableId,
  artist: null,
  artwork: null,
  audioUrl: `https://x/${addressableId}.mp3`,
  visibility: "public",
  artistPubkeys: [],
});

describe("musicSlice — catalog", () => {
  it("upserts items newest-wins by created_at", () => {
    let s = reducer(initial(), itemsUpserted([item("a", 5)]));
    s = reducer(s, itemsUpserted([{ ...item("a", 3), title: "stale" }]));
    expect(s.itemsById["a"].title).toBe("a"); // stale (older) did not clobber
    s = reducer(s, itemsUpserted([{ ...item("a", 9), title: "fresh" }]));
    expect(s.itemsById["a"].title).toBe("fresh");
  });
});

describe("musicSlice — player mirror", () => {
  it("queueLoaded establishes queue + optimistic current + loading", () => {
    const s = reducer(
      initial(),
      queueLoaded({ queueIds: ["a", "b", "c"], currentId: "b" }),
    );
    expect(s.player).toMatchObject({
      queueIds: ["a", "b", "c"],
      originalOrder: ["a", "b", "c"],
      currentId: "b",
      status: "loading",
      shuffle: false,
    });
  });

  it("mirrorTrackChanged updates current + duration and clears error", () => {
    let s = reducer(initial(), playerErrored("boom"));
    s = reducer(s, mirrorTrackChanged({ currentId: "z", durationSec: 200 }));
    expect(s.player).toMatchObject({ currentId: "z", durationSec: 200, error: null });
  });

  it("mirrorStatusChanged / playbackEnded set status", () => {
    let s = reducer(initial(), mirrorStatusChanged("playing"));
    expect(s.player.status).toBe("playing");
    s = reducer(s, playbackEnded());
    expect(s.player.status).toBe("idle");
  });

  it("repeatSet stores the repeat mode", () => {
    const s = reducer(initial(), repeatSet("queue"));
    expect(s.player.repeat).toBe("queue");
  });

  it("shuffleApplied swaps queue order + flag, preserving originalOrder", () => {
    let s = reducer(initial(), queueLoaded({ queueIds: ["a", "b", "c"], currentId: "a" }));
    s = reducer(s, shuffleApplied({ queueIds: ["a", "c", "b"], shuffle: true }));
    expect(s.player.queueIds).toEqual(["a", "c", "b"]);
    expect(s.player.shuffle).toBe(true);
    expect(s.player.originalOrder).toEqual(["a", "b", "c"]);
  });

  it("musicCleared resets to initial", () => {
    let s = reducer(initial(), itemsUpserted([item("a")]));
    s = reducer(s, queueLoaded({ queueIds: ["a"], currentId: "a" }));
    s = reducer(s, musicCleared());
    expect(s).toEqual(initial());
  });
});

describe("shuffleOrder", () => {
  it("pins currentId first and keeps the same set", () => {
    const out = shuffleOrder(["a", "b", "c", "d"], "c", () => 0);
    expect(out[0]).toBe("c");
    expect([...out].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("no current: returns a permutation of the full set", () => {
    const out = shuffleOrder(["a", "b", "c"], null, () => 0);
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("current not in list: still returns the set", () => {
    const out = shuffleOrder(["a", "b"], "zzz", () => 0);
    expect([...out].sort()).toEqual(["a", "b"]);
  });
});

describe("selectors", () => {
  it("selectCurrentItem resolves the catalog entry", () => {
    let s = reducer(initial(), itemsUpserted([item("a")]));
    s = reducer(s, mirrorTrackChanged({ currentId: "a" }));
    expect(selectCurrentItem({ music: s })?.addressableId).toBe("a");
    expect(selectIsCurrent({ music: s }, "a")).toBe(true);
    expect(selectIsCurrent({ music: s }, "b")).toBe(false);
  });

  it("selectQueueIds returns a stable empty array when idle", () => {
    const s = initial();
    expect(selectQueueIds({ music: s })).toEqual([]);
    expect(selectQueueIds({ music: s })).toBe(selectQueueIds({ music: s }));
  });
});
