import type { NostrEvent } from "@thewired/shared-types";

import type { PlatformAdapters } from "@/core/adapters";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { createStore } from "@/store";
import { PERSIST_PER_THREAD, THREAD_PERSIST_ROOTS, hydrateThread, persistThread } from "../threads";
import {
  selectThreadEvents,
  threadEventsMerged,
  threadsCleared,
} from "../slices/threadsSlice";

// Thunk harness: real store + real SQLite adapter over an in-memory FakeDb
// (the spaceChat.test.ts pattern). Sharing one `dbs` map across two stores
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

const ROOT_ID = "r".repeat(64);

const evt = (id: string, createdAt: number): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  created_at: createdAt,
  kind: 1,
  tags: [],
  content: id,
  sig: "f".repeat(128),
});

function makeStore(dbs: Map<string, FakeDb>) {
  const storage = createSqliteStorage(async (name) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb(name));
    return dbs.get(name)!;
  });
  return createStore({ storage } as unknown as PlatformAdapters);
}

const threadsTable = (dbs: Map<string, FakeDb>) =>
  dbs.get("thewired_app")?.tables.get("kv_threads");

describe("threads persistence thunks", () => {
  it("persists a conversation and hydrates it in a fresh store (relaunch round-trip)", async () => {
    const dbs = new Map<string, FakeDb>();
    const storeA = makeStore(dbs);
    storeA.dispatch(
      threadEventsMerged({
        rootId: ROOT_ID,
        events: [evt(ROOT_ID, 100), evt("b".repeat(64), 300), evt("a".repeat(64), 200)],
      }),
    );
    await storeA.dispatch(persistThread(ROOT_ID));
    expect(threadsTable(dbs)?.has(ROOT_ID)).toBe(true);

    const storeB = makeStore(dbs);
    await storeB.dispatch(hydrateThread(ROOT_ID));
    expect(selectThreadEvents(storeB.getState(), ROOT_ID).map((e) => e.content)).toEqual([
      ROOT_ID,
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("persist caps the row at PERSIST_PER_THREAD but always keeps the root", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    const bulk = Array.from({ length: PERSIST_PER_THREAD + 10 }, (_, i) =>
      evt(`${i}`.padStart(64, "0"), 1000 + i),
    );
    store.dispatch(
      threadEventsMerged({ rootId: ROOT_ID, events: [evt(ROOT_ID, 1), ...bulk] }),
    );
    await store.dispatch(persistThread(ROOT_ID));

    const row = JSON.parse(threadsTable(dbs)!.get(ROOT_ID)!) as {
      savedAt: number;
      events: NostrEvent[];
    };
    expect(row.events).toHaveLength(PERSIST_PER_THREAD);
    expect(row.events[0].id).toBe(ROOT_ID); // root retained despite being oldest
    expect(row.events[row.events.length - 1].created_at).toBe(1000 + PERSIST_PER_THREAD + 9);
  });

  it("persist no-ops when the slice entry is empty (identity-switch guard)", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    store.dispatch(threadEventsMerged({ rootId: ROOT_ID, events: [evt(ROOT_ID, 100)] }));
    await store.dispatch(persistThread(ROOT_ID));
    store.dispatch(threadsCleared());
    threadsTable(dbs)!.set(ROOT_ID, JSON.stringify({ savedAt: 1, events: [evt("keep", 1)] }));
    await store.dispatch(persistThread(ROOT_ID));
    const row = JSON.parse(threadsTable(dbs)!.get(ROOT_ID)!) as { events: NostrEvent[] };
    expect(row.events.map((e) => e.id)).toEqual(["keep"]);
  });

  it("hydrate is idempotent per session (second call skips the storage read)", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    await store.dispatch(hydrateThread(ROOT_ID)); // hydrates empty, flags root
    threadsTable(dbs)!.set(
      ROOT_ID,
      JSON.stringify({ savedAt: 1, events: [evt("sneaky", 100)] }),
    );
    await store.dispatch(hydrateThread(ROOT_ID));
    expect(selectThreadEvents(store.getState(), ROOT_ID)).toEqual([]);
  });

  it("hydrate tolerates a corrupt row", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    await store.dispatch(hydrateThread("seed".padEnd(64, "0"))); // force table creation
    threadsTable(dbs)!.set(ROOT_ID, "not json");
    await expect(store.dispatch(hydrateThread(ROOT_ID))).resolves.toBeUndefined();
    expect(selectThreadEvents(store.getState(), ROOT_ID)).toEqual([]);
  });

  it("prunes the stalest rows past THREAD_PERSIST_ROOTS", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    let clock = 0;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => ++clock * 1000);
    try {
      for (let i = 0; i <= THREAD_PERSIST_ROOTS; i++) {
        const rootId = `${i}`.padStart(64, "9");
        store.dispatch(threadEventsMerged({ rootId, events: [evt(rootId, 100 + i)] }));
        await store.dispatch(persistThread(rootId));
      }
    } finally {
      nowSpy.mockRestore();
    }
    const keys = [...threadsTable(dbs)!.keys()];
    expect(keys).toHaveLength(THREAD_PERSIST_ROOTS);
    expect(keys).not.toContain("0".padStart(64, "9")); // stalest evicted
  });
});
