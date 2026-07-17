import type { NostrEvent } from "@thewired/shared-types";

import type { PlatformAdapters } from "@/core/adapters";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { createStore } from "@/store";
import {
  PERSIST_PER_CHANNEL,
  hydrateChannelBacklog,
  persistChannelBacklog,
  purgeSpaceChat,
} from "../spaceChat";
import {
  chatMessageReceived,
  selectChannelMessages,
  spaceChatCleared,
} from "../slices/spaceChatSlice";

// Thunk harness: real store + real SQLite adapter over an in-memory FakeDb
// (the dmEngine.test.ts pattern). Sharing one `dbs` map across two stores
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

const evt = (id: string, createdAt: number): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  created_at: createdAt,
  kind: 9,
  tags: [["h", "s1"]],
  content: `msg ${id}`,
  sig: "f".repeat(128),
});

function makeStore(dbs: Map<string, FakeDb>) {
  const storage = createSqliteStorage(async (name) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb(name));
    return dbs.get(name)!;
  });
  return createStore({ storage } as unknown as PlatformAdapters);
}

const chatTable = (dbs: Map<string, FakeDb>) =>
  dbs.get("thewired_app")?.tables.get("kv_space_chat");

describe("spaceChat thunks", () => {
  it("persists a channel row and hydrates it in a fresh store (relaunch round-trip)", async () => {
    const dbs = new Map<string, FakeDb>();
    const storeA = makeStore(dbs);
    for (const e of [evt("a", 100), evt("c", 300), evt("b", 200)]) {
      storeA.dispatch(chatMessageReceived({ spaceId: "s1", channelId: "general", event: e }));
    }
    await storeA.dispatch(persistChannelBacklog("s1", "general"));
    expect(chatTable(dbs)?.has("s1/general")).toBe(true);

    // Relaunch: same DBs, new store — hydrate must restore before any socket.
    const storeB = makeStore(dbs);
    await storeB.dispatch(hydrateChannelBacklog("s1", "general"));
    expect(
      selectChannelMessages(storeB.getState(), "s1", "general").map((e) => e.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("persist caps the stored row at PERSIST_PER_CHANNEL newest events", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    for (let i = 0; i < PERSIST_PER_CHANNEL + 10; i++) {
      store.dispatch(
        chatMessageReceived({
          spaceId: "s1",
          channelId: "general",
          event: evt(`m${String(i).padStart(3, "0")}`, 1000 + i),
        }),
      );
    }
    await store.dispatch(persistChannelBacklog("s1", "general"));
    const row = JSON.parse(chatTable(dbs)!.get("s1/general")!) as NostrEvent[];
    expect(row.length).toBe(PERSIST_PER_CHANNEL);
    expect(row[row.length - 1].created_at).toBe(1000 + PERSIST_PER_CHANNEL + 9);
  });

  it("persist no-ops when the slice entry is empty (identity-switch guard)", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    store.dispatch(chatMessageReceived({ spaceId: "s1", channelId: "general", event: evt("a", 100) }));
    await store.dispatch(persistChannelBacklog("s1", "general"));
    store.dispatch(spaceChatCleared());
    // Overwrite marker to detect a rogue write.
    chatTable(dbs)!.set("s1/general", JSON.stringify([evt("keep", 1)]));
    await store.dispatch(persistChannelBacklog("s1", "general"));
    const row = JSON.parse(chatTable(dbs)!.get("s1/general")!) as NostrEvent[];
    expect(row.map((e) => e.id)).toEqual(["keep"]);
  });

  it("hydrate is idempotent per session (second call skips the storage read)", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    await store.dispatch(hydrateChannelBacklog("s1", "general")); // hydrates empty
    // A row appearing later must not be merged by a repeat hydrate.
    chatTable(dbs)!.set("s1/general", JSON.stringify([evt("sneaky", 100)]));
    await store.dispatch(hydrateChannelBacklog("s1", "general"));
    expect(selectChannelMessages(store.getState(), "s1", "general")).toEqual([]);
  });

  it("hydrate tolerates a corrupt row", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    // Force table creation, then corrupt the row.
    await store.dispatch(hydrateChannelBacklog("s0", "seed"));
    chatTable(dbs)!.set("s1/general", "not json");
    await expect(store.dispatch(hydrateChannelBacklog("s1", "general"))).resolves.toBeUndefined();
    expect(selectChannelMessages(store.getState(), "s1", "general")).toEqual([]);
  });

  it("purge deletes only the space's rows from slice and storage", async () => {
    const dbs = new Map<string, FakeDb>();
    const store = makeStore(dbs);
    store.dispatch(chatMessageReceived({ spaceId: "s1", channelId: "general", event: evt("a", 100) }));
    store.dispatch(chatMessageReceived({ spaceId: "s1", channelId: "dev", event: evt("b", 100) }));
    store.dispatch(chatMessageReceived({ spaceId: "s2", channelId: "general", event: evt("c", 100) }));
    await store.dispatch(persistChannelBacklog("s1", "general"));
    await store.dispatch(persistChannelBacklog("s1", "dev"));
    await store.dispatch(persistChannelBacklog("s2", "general"));

    await store.dispatch(purgeSpaceChat("s1"));
    expect(selectChannelMessages(store.getState(), "s1", "general")).toEqual([]);
    expect(selectChannelMessages(store.getState(), "s1", "dev")).toEqual([]);
    expect(selectChannelMessages(store.getState(), "s2", "general").map((e) => e.id)).toEqual([
      "c",
    ]);
    expect([...chatTable(dbs)!.keys()]).toEqual(["s2/general"]);
  });
});
