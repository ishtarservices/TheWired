import type { PlatformAdapters } from "@/core/adapters";
import type {
  MySpace,
  SpaceChannel,
  SpaceDetail,
  SpaceMembersResult,
} from "@/lib/api/spaces";
import {
  fetchMySpaces,
  fetchSpaceChannels,
  fetchSpaceDetail,
  fetchSpaceMembers,
} from "@/lib/api/spaces";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { createStore } from "@/store";
import {
  ensureSpaceMeta,
  hydrateMySpaces,
  hydrateSpaceMeta,
  loadMySpaces,
  loadSpaceMeta,
} from "../spaceMeta";
import {
  PERSIST_ROSTER_CAP,
  SPACE_META_CAP,
  mySpacesFetchStarted,
  mySpacesFetchSucceeded,
  spaceMetaCleared,
} from "../slices/spaceMetaSlice";

jest.mock("@/lib/api/spaces", () => ({
  fetchSpaceDetail: jest.fn(),
  fetchSpaceChannels: jest.fn(),
  fetchSpaceMembers: jest.fn(),
  fetchMySpaces: jest.fn(),
}));

const mockDetail = fetchSpaceDetail as jest.MockedFunction<typeof fetchSpaceDetail>;
const mockChannels = fetchSpaceChannels as jest.MockedFunction<typeof fetchSpaceChannels>;
const mockMembers = fetchSpaceMembers as jest.MockedFunction<typeof fetchSpaceMembers>;
const mockMySpaces = fetchMySpaces as jest.MockedFunction<typeof fetchMySpaces>;

// Thunk harness: real store + real SQLite adapter over an in-memory FakeDb
// (the threads.test.ts pattern). Sharing one `dbs` map across two stores
// simulates an app relaunch — the hydrate-before-network assertion.

class FakeDb implements SqlDatabase {
  tables = new Map<string, Map<string, string>>();
  constructor(public readonly name: string) {}
  private table(sql: string): Map<string, string> {
    const match = /(?:FROM|INTO|EXISTS)\s+(kv_\w+)/i.exec(sql)!;
    if (!this.tables.has(match[1])) this.tables.set(match[1], new Map());
    return this.tables.get(match[1])!;
  }
  async execAsync(sql: string): Promise<void> {
    if (/CREATE TABLE/i.test(sql)) this.table(sql);
  }
  async runAsync(sql: string, ...params: string[]): Promise<unknown> {
    const table = this.table(sql);
    if (/INSERT OR REPLACE/i.test(sql)) table.set(params[0], params[1]);
    else if (/WHERE key = \?/i.test(sql)) table.delete(params[0]);
    else table.clear();
    return undefined;
  }
  async getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null> {
    const value = this.table(sql).get(params[0]);
    return value === undefined ? null : ({ value } as T);
  }
  async getAllAsync<T>(sql: string): Promise<T[]> {
    const table = this.table(sql);
    if (/SELECT key/i.test(sql)) return [...table.keys()].map((key) => ({ key }) as T);
    return [...table.values()].map((value) => ({ value }) as T);
  }
  async closeAsync(): Promise<void> {}
}

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

const membersResult = (
  pubkeys: string[],
  profiles: SpaceMembersResult["profiles"] = {},
): SpaceMembersResult => ({ pubkeys, profiles });

function makeStore(dbs: Map<string, FakeDb>, signer: unknown = null) {
  const storage = createSqliteStorage(async (name) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb(name));
    return dbs.get(name)!;
  });
  return createStore({ storage, signer } as unknown as PlatformAdapters);
}

const metaTable = (dbs: Map<string, FakeDb>) =>
  dbs.get("thewired_app")?.tables.get("kv_space_meta");
const userStateTable = (dbs: Map<string, FakeDb>) =>
  dbs.get("thewired_app")?.tables.get("kv_user_state");

beforeEach(() => {
  mockDetail.mockReset().mockImplementation(async (id) => detail(id));
  mockChannels.mockReset().mockResolvedValue([channel("general")]);
  mockMembers.mockReset().mockResolvedValue(membersResult(["p1"]));
  mockMySpaces.mockReset().mockResolvedValue([mySpace("s1")]);
});

describe("loadSpaceMeta", () => {
  it("fetches, fills the slice, and write-throughs a row capped at PERSIST_ROSTER_CAP", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    const roster = Array.from({ length: PERSIST_ROSTER_CAP + 10 }, (_, i) => `pk${i}`);
    mockMembers.mockResolvedValue(membersResult(roster));

    await store.dispatch(loadSpaceMeta("s1"));

    const entry = store.getState().spaceMeta.bySpace.s1;
    expect(entry?.status).toBe("ready");
    expect(entry?.detail?.id).toBe("s1");
    expect(entry?.memberPubkeys).toHaveLength(PERSIST_ROSTER_CAP + 10); // slice keeps all

    const row = JSON.parse(metaTable(dbs)!.get("s1")!) as {
      fetchedAt: number;
      memberPubkeys: string[];
    };
    expect(row.memberPubkeys).toHaveLength(PERSIST_ROSTER_CAP); // persisted prefix
    expect(row.fetchedAt).toBe(entry?.fetchedAt);
  });

  it("gates on freshness — a second load inside the window fetches nothing; force bypasses", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    await store.dispatch(loadSpaceMeta("s1"));
    await store.dispatch(loadSpaceMeta("s1"));
    expect(mockDetail).toHaveBeenCalledTimes(1);
    await store.dispatch(loadSpaceMeta("s1", { force: true }));
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("gates on in-flight status — concurrent loads collapse to one fetch", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    let resolveDetail!: (d: SpaceDetail) => void;
    mockDetail.mockImplementation(
      () => new Promise<SpaceDetail>((resolve) => (resolveDetail = resolve)),
    );

    const first = store.dispatch(loadSpaceMeta("s1"));
    const second = store.dispatch(loadSpaceMeta("s1")); // early-returns
    expect(mockDetail).toHaveBeenCalledTimes(1);
    resolveDetail(detail("s1"));
    await Promise.all([first, second]);
    expect(store.getState().spaceMeta.bySpace.s1?.status).toBe("ready");
  });

  it("detail failure keeps the entry data-free with the error, and persists nothing", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    mockDetail.mockRejectedValue(new Error("down"));
    await store.dispatch(loadSpaceMeta("s1"));
    const entry = store.getState().spaceMeta.bySpace.s1;
    expect(entry?.status).toBe("idle");
    expect(entry?.error).toBe("down");
    expect(metaTable(dbs)?.has("s1")).toBeFalsy();
  });

  it("seeds profilesSlice from the inline backend profiles", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    mockMembers.mockResolvedValue(
      membersResult(["p1"], { p1: { created_at: 5, name: "Luna" } }),
    );
    await store.dispatch(loadSpaceMeta("s1"));
    expect(store.getState().profiles.byPubkey.p1?.name).toBe("Luna");
  });

  it("identity valve: cleared mid-flight → no slice entry, no persisted row", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    let resolveDetail!: (d: SpaceDetail) => void;
    mockDetail.mockImplementation(
      () => new Promise<SpaceDetail>((resolve) => (resolveDetail = resolve)),
    );

    const pending = store.dispatch(loadSpaceMeta("s1"));
    store.dispatch(spaceMetaCleared()); // account switch while in flight
    resolveDetail(detail("s1"));
    await pending;

    expect(store.getState().spaceMeta.bySpace.s1).toBeUndefined();
    expect(metaTable(dbs)?.has("s1")).toBeFalsy();
  });

  it("prunes the stalest persisted rows past SPACE_META_CAP, never a joined id", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    // s0 is joined — pinned in both the slice LRU and the storage prune.
    store.dispatch(mySpacesFetchStarted());
    store.dispatch(mySpacesFetchSucceeded({ spaces: [mySpace("s0")], fetchedAt: 1 }));

    // 1ms ticks — keeps savedAt monotonic without tripping RTK's dev
    // middleware timing warnings (it measures itself with Date.now).
    let clock = 0;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => ++clock);
    try {
      for (let i = 0; i <= SPACE_META_CAP; i++) {
        await store.dispatch(loadSpaceMeta(`s${i}`));
      }
    } finally {
      nowSpy.mockRestore();
    }

    const keys = [...metaTable(dbs)!.keys()];
    expect(keys).toHaveLength(SPACE_META_CAP);
    expect(keys).toContain("s0"); // stalest, but joined — survived
    expect(keys).not.toContain("s1"); // stalest non-joined — pruned
  });
});

describe("hydrateSpaceMeta / ensureSpaceMeta", () => {
  it("hydrates a persisted row in a fresh store without touching the network", async () => {
    const dbs = new Map<string, FakeDb>();
    const storeA = makeStore(dbs);
    await storeA.dispatch(loadSpaceMeta("s1"));

    mockDetail.mockClear();
    const storeB = makeStore(dbs);
    await storeB.dispatch(hydrateSpaceMeta("s1"));
    const entry = storeB.getState().spaceMeta.bySpace.s1;
    expect(entry?.detail?.id).toBe("s1");
    expect(entry?.channels?.map((c) => c.id)).toEqual(["general"]);
    expect(entry?.status).toBe("idle"); // paint now, refresh still owed
    expect(mockDetail).not.toHaveBeenCalled();
  });

  it("is idempotent per session — the second call skips the storage read", async () => {
    const dbs = new Map<string, FakeDb>();
    const storeA = makeStore(dbs);
    await storeA.dispatch(loadSpaceMeta("s1"));

    const storeB = makeStore(dbs);
    await storeB.dispatch(hydrateSpaceMeta("s1"));
    metaTable(dbs)!.set(
      "s1",
      JSON.stringify({ savedAt: 1, fetchedAt: 1, detail: detail("s1", "sneaky"), channels: [], memberPubkeys: [] }),
    );
    await storeB.dispatch(hydrateSpaceMeta("s1"));
    expect(storeB.getState().spaceMeta.bySpace.s1?.detail?.name).toBe("s1");
  });

  it("tolerates a corrupt row (hydrates empty, loadSpaceMeta rebuilds)", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    await store.dispatch(hydrateSpaceMeta("seed")); // force table creation
    metaTable(dbs)!.set("s1", "not json");
    await expect(store.dispatch(hydrateSpaceMeta("s1"))).resolves.toBeUndefined();
    expect(store.getState().spaceMeta.bySpace.s1).toBeUndefined();
    expect(store.getState().spaceMeta.hydrated.s1).toBe(true);
  });

  it("ensureSpaceMeta hydrates, loads, and returns the entry", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    const entry = await store.dispatch(ensureSpaceMeta("s1"));
    expect(entry?.detail?.id).toBe("s1");
    expect(entry?.status).toBe("ready");
    expect(store.getState().spaceMeta.hydrated.s1).toBe(true);
  });
});

describe("hydrateMySpaces / loadMySpaces", () => {
  const signer = { getPublicKey: async () => "me" };

  it("guest (no signer): succeeds with [] and persists nothing", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs, null);
    await store.dispatch(loadMySpaces());
    expect(store.getState().spaceMeta.mySpaces).toEqual([]);
    expect(store.getState().spaceMeta.mySpacesStatus).toBe("ready");
    expect(mockMySpaces).not.toHaveBeenCalled();
    expect(userStateTable(dbs)?.has("spaces.mySpaces")).toBeFalsy();
  });

  it("signed in: fetches, stores, persists; a fresh store hydrates it back", async () => {
    const dbs = new Map<string, FakeDb>();
    const storeA = makeStore(dbs, signer);
    await storeA.dispatch(loadMySpaces());
    expect(mockMySpaces).toHaveBeenCalledWith(signer);
    expect(storeA.getState().spaceMeta.mySpaces?.map((s) => s.id)).toEqual(["s1"]);
    expect(userStateTable(dbs)!.has("spaces.mySpaces")).toBe(true);

    const storeB = makeStore(dbs, signer);
    await storeB.dispatch(hydrateMySpaces());
    expect(storeB.getState().spaceMeta.mySpaces?.map((s) => s.id)).toEqual(["s1"]);
    // Hydrate never stamps freshness — the next load still refetches.
    expect(storeB.getState().spaceMeta.mySpacesFetchedAt).toBe(0);
  });

  it("gates on freshness and in-flight status; force bypasses", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs, signer);
    await store.dispatch(loadMySpaces());
    await store.dispatch(loadMySpaces());
    expect(mockMySpaces).toHaveBeenCalledTimes(1);
    await store.dispatch(loadMySpaces({ force: true }));
    expect(mockMySpaces).toHaveBeenCalledTimes(2);
  });

  it("identity valve: cleared mid-flight → stale list discarded, nothing persisted", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs, signer);
    let resolveSpaces!: (s: MySpace[]) => void;
    mockMySpaces.mockImplementation(
      () => new Promise<MySpace[]>((resolve) => (resolveSpaces = resolve)),
    );

    const pending = store.dispatch(loadMySpaces());
    store.dispatch(spaceMetaCleared());
    resolveSpaces([mySpace("stale")]);
    await pending;

    expect(store.getState().spaceMeta.mySpaces).toBeNull();
    expect(userStateTable(dbs)?.has("spaces.mySpaces")).toBeFalsy();
  });

  it("hydrate is idempotent and tolerates a missing row", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs, signer);
    await store.dispatch(hydrateMySpaces());
    expect(store.getState().spaceMeta.mySpaces).toBeNull();
    expect(store.getState().spaceMeta.mySpacesHydrated).toBe(true);

    userStateTable(dbs)?.set(
      "spaces.mySpaces",
      JSON.stringify({ savedAt: 1, spaces: [mySpace("late")] }),
    );
    await store.dispatch(hydrateMySpaces()); // guarded — no re-read
    expect(store.getState().spaceMeta.mySpaces).toBeNull();
  });
});
