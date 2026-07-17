import type { MySpace, SpaceChannel, SpaceDetail } from "@/lib/api/spaces";
import {
  SPACE_META_CAP,
  mySpacesFetchFailed,
  mySpacesFetchStarted,
  mySpacesFetchSucceeded,
  mySpacesHydrated,
  mySpacesInvalidated,
  selectMySpaces,
  selectMySpacesFetchedAt,
  selectMySpacesStatus,
  selectSpaceMeta,
  spaceMetaCleared,
  spaceMetaFetchFailed,
  spaceMetaFetchStarted,
  spaceMetaFetchSucceeded,
  spaceMetaHydrated,
  spaceMetaInvalidated,
  spaceMetaSlice,
} from "../slices/spaceMetaSlice";

type SliceState = ReturnType<typeof spaceMetaSlice.reducer>;

const reduce = (
  state: SliceState | undefined,
  action: Parameters<typeof spaceMetaSlice.reducer>[1],
) => spaceMetaSlice.reducer(state, action);

const wrap = (spaceMeta: SliceState) => ({ spaceMeta });

const detail = (id: string, name = id): SpaceDetail => ({
  id,
  name,
  about: null,
  picture: null,
  hostRelay: null,
  spaceMode: "platform",
  tags: [],
  category: null,
  mode: "read-write",
  memberCount: 1,
  activeMembers24h: 0,
  messagesLast24h: 0,
  featured: false,
  createdAt: null,
  creatorPubkey: null,
});

const channel = (id: string): SpaceChannel => ({
  id,
  type: "chat",
  label: id,
  isDefault: true,
  categoryId: null,
  position: 0,
  adminOnly: false,
  slowModeSeconds: 0,
  feedMode: "all",
});

const mySpace = (id: string): MySpace => ({
  id,
  name: id,
  about: null,
  picture: null,
  hostRelay: null,
  mode: "read-write",
  memberCount: 1,
});

const succeeded = (spaceId: string, fetchedAt = 100) =>
  spaceMetaFetchSucceeded({
    spaceId,
    detail: detail(spaceId),
    channels: [channel("general")],
    memberPubkeys: ["p1", "p2"],
    fetchedAt,
  });

describe("spaceMetaSlice — per-space status machine", () => {
  it('starts "loading" cold, "refreshing" once a detail is on screen (SWR)', () => {
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    expect(selectSpaceMeta(wrap(state), "s1")?.status).toBe("loading");

    state = reduce(state, succeeded("s1"));
    const ready = selectSpaceMeta(wrap(state), "s1");
    expect(ready?.status).toBe("ready");
    expect(ready?.fetchedAt).toBe(100);
    expect(ready?.detail?.id).toBe("s1");
    expect(ready?.channels?.map((c) => c.id)).toEqual(["general"]);
    expect(ready?.memberPubkeys).toEqual(["p1", "p2"]);

    state = reduce(state, spaceMetaFetchStarted({ spaceId: "s1" }));
    const refreshing = selectSpaceMeta(wrap(state), "s1");
    expect(refreshing?.status).toBe("refreshing");
    // The stale data stays on screen through the refresh.
    expect(refreshing?.detail?.id).toBe("s1");
  });

  it("failure keeps whatever data exists: ready when warm, idle when cold", () => {
    // Cold failure — no data to keep.
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, spaceMetaFetchFailed({ spaceId: "s1", error: "down" }));
    let entry = selectSpaceMeta(wrap(state), "s1");
    expect(entry?.status).toBe("idle");
    expect(entry?.error).toBe("down");
    expect(entry?.detail).toBeNull();

    // Warm failure — stale data intact, back to "ready".
    state = reduce(state, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, succeeded("s1"));
    state = reduce(state, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, spaceMetaFetchFailed({ spaceId: "s1", error: "again" }));
    entry = selectSpaceMeta(wrap(state), "s1");
    expect(entry?.status).toBe("ready");
    expect(entry?.detail?.id).toBe("s1");
    expect(entry?.error).toBe("again");
  });

  it("a late success after clear/eviction no-ops (identity valve upstream of persist)", () => {
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, spaceMetaCleared());
    state = reduce(state, succeeded("s1"));
    expect(selectSpaceMeta(wrap(state), "s1")).toBeUndefined();
  });
});

describe("spaceMetaSlice — LRU with mySpaces pinning", () => {
  it("evicts the stalest entry beyond SPACE_META_CAP, skipping joined ids", () => {
    let state = reduce(undefined, mySpacesFetchStarted());
    state = reduce(
      state,
      mySpacesFetchSucceeded({ spaces: [mySpace("pinned")], fetchedAt: 1 }),
    );

    state = reduce(state, spaceMetaFetchStarted({ spaceId: "pinned" }));
    for (let i = 1; i <= SPACE_META_CAP; i++) {
      state = reduce(state, spaceMetaFetchStarted({ spaceId: `s${i}` }));
    }

    // Cap held; "pinned" (the oldest touch) survived, s1 was evicted instead.
    expect(Object.keys(state.bySpace)).toHaveLength(SPACE_META_CAP);
    expect(selectSpaceMeta(wrap(state), "pinned")).toBeDefined();
    expect(selectSpaceMeta(wrap(state), "s1")).toBeUndefined();
    expect(selectSpaceMeta(wrap(state), `s${SPACE_META_CAP}`)).toBeDefined();
  });

  it("re-touching an id moves it to the back of the eviction order", () => {
    let state: SliceState | undefined;
    for (let i = 1; i <= SPACE_META_CAP; i++) {
      state = reduce(state, spaceMetaFetchStarted({ spaceId: `s${i}` }));
    }
    state = reduce(state, spaceMetaFetchStarted({ spaceId: "s1" })); // touch
    state = reduce(state, spaceMetaFetchStarted({ spaceId: "fresh" }));
    expect(selectSpaceMeta(wrap(state!), "s1")).toBeDefined();
    expect(selectSpaceMeta(wrap(state!), "s2")).toBeUndefined(); // now stalest
  });
});

describe("spaceMetaSlice — hydrate merge-if-emptier", () => {
  const stored = {
    detail: detail("s1", "from-disk"),
    channels: [channel("disk-chan")],
    memberPubkeys: ["disk"],
    fetchedAt: 50,
  };

  it("fills an empty slice entry and flags the space hydrated", () => {
    const state = reduce(undefined, spaceMetaHydrated({ spaceId: "s1", entry: stored }));
    const entry = selectSpaceMeta(wrap(state), "s1");
    expect(entry?.detail?.name).toBe("from-disk");
    expect(entry?.channels?.map((c) => c.id)).toEqual(["disk-chan"]);
    expect(entry?.fetchedAt).toBe(50);
    // Hydrated data is a seed, not a completed load.
    expect(entry?.status).toBe("idle");
    expect(state.hydrated.s1).toBe(true);
  });

  it("never overwrites a live fetch that beat the SQLite read", () => {
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, succeeded("s1", 100));
    state = reduce(state, spaceMetaHydrated({ spaceId: "s1", entry: stored }));
    const entry = selectSpaceMeta(wrap(state), "s1");
    expect(entry?.detail?.name).toBe("s1"); // live data kept
    expect(entry?.fetchedAt).toBe(100);
    expect(state.hydrated.s1).toBe(true);
  });

  it("a null row (missing/corrupt) still marks the space hydrated", () => {
    const state = reduce(undefined, spaceMetaHydrated({ spaceId: "s1", entry: null }));
    expect(selectSpaceMeta(wrap(state), "s1")).toBeUndefined();
    expect(state.hydrated.s1).toBe(true);
  });
});

describe("spaceMetaSlice — invalidation and clearing", () => {
  it("invalidated resets fetchedAt but keeps the data warm", () => {
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, succeeded("s1", 100));
    state = reduce(state, spaceMetaInvalidated({ spaceId: "s1" }));
    const entry = selectSpaceMeta(wrap(state), "s1");
    expect(entry?.fetchedAt).toBe(0);
    expect(entry?.detail?.id).toBe("s1");
  });

  it("cleared resets everything (logout / account switch)", () => {
    let state = reduce(undefined, spaceMetaFetchStarted({ spaceId: "s1" }));
    state = reduce(state, succeeded("s1"));
    state = reduce(state, spaceMetaHydrated({ spaceId: "s2", entry: null }));
    state = reduce(state, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("m")], fetchedAt: 9 }));
    state = reduce(state, spaceMetaCleared());
    expect(state.bySpace).toEqual({});
    expect(state.spaceOrder).toEqual([]);
    expect(state.hydrated).toEqual({});
    expect(selectMySpaces(wrap(state))).toBeNull();
    expect(selectMySpacesStatus(wrap(state))).toBe("idle");
    expect(selectMySpacesFetchedAt(wrap(state))).toBe(0);
    expect(state.mySpacesHydrated).toBe(false);
  });
});

describe("spaceMetaSlice — my-spaces machine", () => {
  it("loading cold, refreshing warm; success stores the list", () => {
    let state = reduce(undefined, mySpacesFetchStarted());
    expect(selectMySpacesStatus(wrap(state))).toBe("loading");
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("a")], fetchedAt: 7 }));
    expect(selectMySpaces(wrap(state))?.map((s) => s.id)).toEqual(["a"]);
    expect(selectMySpacesFetchedAt(wrap(state))).toBe(7);
    state = reduce(state, mySpacesFetchStarted());
    expect(selectMySpacesStatus(wrap(state))).toBe("refreshing");
  });

  it("failure keeps a warm list ('ready'), idles a cold one", () => {
    let state = reduce(undefined, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchFailed());
    expect(selectMySpacesStatus(wrap(state))).toBe("idle");
    expect(selectMySpaces(wrap(state))).toBeNull();

    state = reduce(state, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("a")], fetchedAt: 1 }));
    state = reduce(state, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchFailed());
    expect(selectMySpacesStatus(wrap(state))).toBe("ready");
    expect(selectMySpaces(wrap(state))?.map((s) => s.id)).toEqual(["a"]);
  });

  it("a late success without a live fetch is ignored (cleared mid-flight valve)", () => {
    let state = reduce(undefined, mySpacesFetchStarted());
    state = reduce(state, spaceMetaCleared());
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("stale")], fetchedAt: 9 }));
    expect(selectMySpaces(wrap(state))).toBeNull();
    expect(selectMySpacesFetchedAt(wrap(state))).toBe(0);
  });

  it("hydrate merges only while the slice is emptier and never stamps fetchedAt", () => {
    let state = reduce(undefined, mySpacesHydrated({ spaces: [mySpace("disk")] }));
    expect(selectMySpaces(wrap(state))?.map((s) => s.id)).toEqual(["disk"]);
    expect(selectMySpacesFetchedAt(wrap(state))).toBe(0); // still owes a load
    expect(state.mySpacesHydrated).toBe(true);

    state = reduce(state, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("live")], fetchedAt: 5 }));
    state = reduce(state, mySpacesHydrated({ spaces: [mySpace("disk")] }));
    expect(selectMySpaces(wrap(state))?.map((s) => s.id)).toEqual(["live"]);
  });

  it("invalidated zeroes fetchedAt but keeps the list", () => {
    let state = reduce(undefined, mySpacesFetchStarted());
    state = reduce(state, mySpacesFetchSucceeded({ spaces: [mySpace("a")], fetchedAt: 5 }));
    state = reduce(state, mySpacesInvalidated());
    expect(selectMySpacesFetchedAt(wrap(state))).toBe(0);
    expect(selectMySpaces(wrap(state))?.map((s) => s.id)).toEqual(["a"]);
  });
});
