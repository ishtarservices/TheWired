import { createSqliteStorage, type SqlDatabase } from "../sqliteStorage";

// In-memory fake implementing the SqlDatabase slice. The adapter's SQL is a
// closed set of statements, so a tiny pattern-matcher is enough.
class FakeDb implements SqlDatabase {
  tables = new Map<string, Map<string, string>>();
  closed = false;

  constructor(public readonly name: string) {}

  private table(sql: string): Map<string, string> {
    const match = /(?:FROM|INTO|EXISTS)\s+(kv_\w+)/i.exec(sql);
    if (!match) throw new Error(`no table in: ${sql}`);
    if (!this.tables.has(match[1])) this.tables.set(match[1], new Map());
    return this.tables.get(match[1])!;
  }

  async execAsync(sql: string): Promise<void> {
    if (/CREATE TABLE/i.test(sql)) this.table(sql);
  }

  async runAsync(sql: string, ...params: string[]): Promise<unknown> {
    const table = this.table(sql);
    if (/INSERT OR REPLACE/i.test(sql)) {
      table.set(params[0], params[1]);
    } else if (/DELETE FROM \S+ WHERE key = \?/i.test(sql)) {
      table.delete(params[0]);
    } else if (/DELETE FROM/i.test(sql)) {
      table.clear();
    }
    return undefined;
  }

  async getFirstAsync<T>(sql: string, ...params: string[]): Promise<T | null> {
    const value = this.table(sql).get(params[0]);
    return value === undefined ? null : ({ value } as T);
  }

  async getAllAsync<T>(sql: string): Promise<T[]> {
    const table = this.table(sql);
    if (/SELECT key/i.test(sql)) {
      return [...table.keys()].map((key) => ({ key }) as T);
    }
    return [...table.values()].map((value) => ({ value }) as T);
  }

  async closeAsync(): Promise<void> {
    this.closed = true;
  }
}

function makeStorage() {
  const dbs: FakeDb[] = [];
  const storage = createSqliteStorage(async (name) => {
    const db = new FakeDb(name);
    dbs.push(db);
    return db;
  });
  return { storage, dbs };
}

describe("sqliteStorage", () => {
  it("round-trips typed values through put/get/delete", async () => {
    const { storage } = makeStorage();
    const store = storage.getStore<{ n: number }>("events");

    await store.put("a", { n: 1 });
    expect(await store.get("a")).toEqual({ n: 1 });

    await store.put("a", { n: 2 }); // upsert
    expect(await store.get("a")).toEqual({ n: 2 });

    await store.delete("a");
    expect(await store.get("a")).toBeUndefined();
  });

  it("getAll / getAllKeys / clear cover the whole store", async () => {
    const { storage } = makeStorage();
    const store = storage.getStore<string>("profiles");
    await store.put("x", "1");
    await store.put("y", "2");

    expect((await store.getAll()).sort()).toEqual(["1", "2"]);
    expect((await store.getAllKeys()).sort()).toEqual(["x", "y"]);

    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });

  it("stores are isolated per logical name", async () => {
    const { storage } = makeStorage();
    await storage.getStore<string>("events").put("k", "event");
    await storage.getStore<string>("profiles").put("k", "profile");

    expect(await storage.getStore<string>("events").get("k")).toBe("event");
    expect(await storage.getStore<string>("profiles").get("k")).toBe("profile");
  });

  it("uses the app DB before login and the account DB after openForAccount", async () => {
    const { storage, dbs } = makeStorage();
    const store = storage.getStore<string>("user_state");

    await store.put("k", "app-value");
    expect(dbs[0].name).toBe("thewired_app");

    await storage.openForAccount("abc123");
    expect(dbs[1].name).toBe("thewired_abc123");

    // Same store handle now resolves the account DB (per-call resolution).
    expect(await store.get("k")).toBeUndefined();
    await store.put("k", "account-value");
    expect(await store.get("k")).toBe("account-value");

    // App DB kept its own copy.
    expect(dbs[0].tables.get("kv_user_state")?.get("k")).toBe('"app-value"');
  });

  it("getAppStore always resolves the app DB, even while an account is open", async () => {
    const { storage, dbs } = makeStorage();
    await storage.openForAccount("abc123");

    await storage.getAppStore<string>("user_state").put("prefs.themePreset", "neon");
    expect(dbs.find((db) => db.name === "thewired_app")).toBeDefined();
    expect(
      dbs.find((db) => db.name === "thewired_app")!.tables.get("kv_user_state")?.get("prefs.themePreset"),
    ).toBe('"neon"');
    // The account DB never saw the write.
    expect(
      dbs.find((db) => db.name === "thewired_abc123")!.tables.get("kv_user_state")?.get("prefs.themePreset"),
    ).toBeUndefined();
  });

  it("switching accounts closes the previous account DB", async () => {
    const { storage, dbs } = makeStorage();
    await storage.openForAccount("aaa");
    await storage.openForAccount("bbb");
    await Promise.resolve(); // let the deferred close settle

    expect(dbs.find((db) => db.name === "thewired_aaa")!.closed).toBe(true);
    expect(dbs.find((db) => db.name === "thewired_bbb")!.closed).toBe(false);
  });

  it("close() releases handles and falls back to the app DB lazily", async () => {
    const { storage, dbs } = makeStorage();
    await storage.openForAccount("aaa");
    await storage.close();
    expect(dbs.every((db) => db.closed)).toBe(true);

    // Next access lazily reopens a fresh app DB.
    await storage.getStore<string>("user_state").put("k", "v");
    const reopened = dbs[dbs.length - 1];
    expect(reopened.name).toBe("thewired_app");
    expect(reopened.closed).toBe(false);
  });
});
