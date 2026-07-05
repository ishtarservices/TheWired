import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { createNostrEngine } from "../engine";
import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { verifyEventSync } from "../verifyEvent";
import { createStore } from "@/store";

// End-to-end engine harness: real store, real SQLite adapter over an
// in-memory fake DB, real verifier, fake sockets.

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  frames(): unknown[][] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
  reqFilters(subId: string): Record<string, unknown> | undefined {
    const reqs = this.frames().filter((f) => f[0] === "REQ" && f[1] === subId);
    return reqs.length ? (reqs[reqs.length - 1][2] as Record<string, unknown>) : undefined;
  }
}

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

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);

function signed(content: string, created_at = 1_700_000_000): NostrEvent {
  return finalizeEvent({ kind: 1, created_at, tags: [], content }, generateSecretKey());
}

function makeHarness(opts: { dbs?: Map<string, FakeDb>; signer?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const dbs = opts.dbs ?? new Map<string, FakeDb>();
  const storage = createSqliteStorage(async (name) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb(name));
    return dbs.get(name)!;
  });
  const adapters: PlatformAdapters = {
    ws: {
      create() {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    },
    verifier: { verify: async (event) => verifyEventSync(event) },
    storage,
    signer: opts.signer ? new LocalNsecSigner(secretKey) : null,
    secretStore: {
      getSecret: async () => null,
      setSecret: async () => {},
      deleteSecret: async () => {},
    },
    http: { fetch: async () => Promise.reject(new Error("nope")) },
    push: {
      registerForPush: async () => Promise.reject(new Error("nope")),
      presentLocal: async () => {},
    },
  };
  const store = createStore(adapters);
  const engine = createNostrEngine({
    adapters,
    dispatch: store.dispatch,
    getState: store.getState,
    relays: ["wss://test"],
  });
  return { engine, store, sockets, dbs };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 80));

describe("nostr engine", () => {
  it("verifies incoming events and drops forgeries", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const good = signed("legit");
    const forged = { ...signed("forged"), content: "tampered" };
    sockets[0].message(["EVENT", "feed-global", good]);
    sockets[0].message(["EVENT", "feed-global", forged]);
    await flush();

    const { feed } = store.getState();
    expect(feed.ids).toEqual([good.id]);
    engine.destroy();
  });

  it("hydrates the feed from SQLite before any socket opens", async () => {
    const dbs = new Map<string, FakeDb>();
    const cached = signed("from cache");
    const db = new FakeDb("thewired_app");
    db.tables.set("kv_events", new Map([[cached.id, JSON.stringify(cached)]]));
    db.tables.set(
      "kv_user_state",
      new Map([["feed.global", JSON.stringify([cached.id])]]),
    );
    dbs.set("thewired_app", db);

    const { engine, store, sockets } = makeHarness({ dbs });
    await engine.start(null);

    // Feed populated straight from storage; the socket hasn't even opened.
    expect(store.getState().feed.ids).toEqual([cached.id]);
    expect(sockets[0].readyState).toBe(0);

    // And the live REQ uses a fresh `since` derived from the cache.
    sockets[0].open();
    const filter = sockets[0].reqFilters("feed-global");
    expect(filter?.since).toBe(cached.created_at - 60);
    engine.destroy();
  });

  it("publishNote signs, inserts optimistically, and resolves on relay OK", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const confirmed = engine.publishNote("hello from mobile");
    await flush();

    const { feed } = store.getState();
    expect(feed.ids).toHaveLength(1);
    const event = feed.entities[feed.ids[0]];
    expect(event.pubkey).toBe(pubkey);
    expect(verifyEventSync(event)).toBe(true);

    // The relay saw the EVENT frame; acknowledge it.
    const frame = sockets[0].frames().find((f) => f[0] === "EVENT");
    expect(frame).toBeDefined();
    sockets[0].message(["OK", event.id, true, ""]);
    await expect(confirmed).resolves.toBe(true);
    engine.destroy();
  });

  it("publishNote rejects for guests (no signer)", async () => {
    const { engine } = makeHarness();
    await engine.start(null);
    await expect(engine.publishNote("nope")).rejects.toThrow(/sign in/i);
    engine.destroy();
  });

  it("foreground resubscribes with a fresh since after suspension", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const live = signed("live one", 1_800_000_000);
    sockets[0].message(["EVENT", "feed-global", live]);
    await flush();

    engine.handleBackground();
    engine.handleForeground();
    const reopened = sockets[sockets.length - 1];
    reopened.open();

    const filter = reopened.reqFilters("feed-global");
    expect(filter?.since).toBe(live.created_at - 60);
    engine.destroy();
  });

  it("fetches kind-0s via requestProfiles and stores the newest", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const author = generateSecretKey();
    const authorPk = getPublicKey(author);
    engine.requestProfiles([authorPk]);

    const profileReq = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("profiles-"));
    expect(profileReq).toBeDefined();
    expect((profileReq![2] as { authors: string[] }).authors).toEqual([authorPk]);

    const kind0 = finalizeEvent(
      {
        kind: 0,
        created_at: 1_700_000_000,
        tags: [],
        content: JSON.stringify({ name: "alice" }),
      },
      author,
    );
    sockets[0].message(["EVENT", profileReq![1], kind0]);
    await flush();

    expect(store.getState().profiles.byPubkey[authorPk]?.name).toBe("alice");
    engine.destroy();
  });
});
