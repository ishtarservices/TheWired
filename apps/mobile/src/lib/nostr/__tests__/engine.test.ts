import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { createNostrEngine } from "../engine";
import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { verifyEventSync } from "../verifyEvent";
import { createStore } from "@/store";
import { followsReceived } from "@/store/slices/followsSlice";
import {
  THREAD_EVENTS_CAP,
  threadEventsMerged,
  threadFetchCompleted,
  threadFetchStarted,
} from "@/store/slices/threadsSlice";

type HarnessStore = ReturnType<typeof makeHarness>["store"];

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
  /** All filters of the latest REQ for `subId` (multi-filter REQs). */
  reqAllFilters(subId: string): Record<string, unknown>[] | undefined {
    const reqs = this.frames().filter((f) => f[0] === "REQ" && f[1] === subId);
    return reqs.length
      ? (reqs[reqs.length - 1].slice(2) as Record<string, unknown>[])
      : undefined;
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

function signedBy(sk: Uint8Array, content: string, created_at = 1_700_000_000): NostrEvent {
  return finalizeEvent({ kind: 1, created_at, tags: [], content }, sk);
}

function kind3By(sk: Uint8Array, follows: string[], created_at = 1_700_000_000): NostrEvent {
  return finalizeEvent(
    { kind: 3, created_at, tags: follows.map((pk) => ["p", pk]), content: "" },
    sk,
  );
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
    expect(feed.byContext.global.ids).toEqual([good.id]);
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
    expect(store.getState().feed.byContext.global.ids).toEqual([cached.id]);
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
    expect(feed.byContext.global.ids).toHaveLength(1);
    const event = feed.byContext.global.entities[feed.byContext.global.ids[0]];
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

describe("engine.fetchEvents", () => {
  it("collects verified events and resolves after EOSE (+grace)", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const promise = engine.fetchEvents([{ kinds: [1], authors: ["a"] }]);
    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    expect(req).toBeDefined();

    const one = signed("thread reply");
    const forged = { ...signed("bad"), content: "tampered" };
    sockets[0].message(["EVENT", req![1], one]);
    sockets[0].message(["EVENT", req![1], forged]);
    sockets[0].message(["EOSE", req![1]]);

    const events = await promise;
    expect(events.map((e) => e.id)).toEqual([one.id]);
    // Sub closed after resolution.
    expect(sockets[0].frames()).toContainEqual(["CLOSE", req![1]]);
    engine.destroy();
  });

  it("still delivers events the feed has already seen (dedup is per-surface)", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const note = signed("seen in feed first");
    sockets[0].message(["EVENT", "feed-global", note]);
    await flush();

    const promise = engine.fetchEvents([{ ids: [note.id] }]);
    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    sockets[0].message(["EVENT", req![1], note]);
    sockets[0].message(["EOSE", req![1]]);

    const events = await promise;
    expect(events.map((e) => e.id)).toEqual([note.id]);
    engine.destroy();
  });
});

describe("feed contexts (global/follows)", () => {
  const followedSk = generateSecretKey();
  const followedPk = getPublicKey(followedSk);

  function seedFollows(store: HarnessStore, pubkeys: string[]): void {
    store.dispatch(followsReceived({ pubkeys, listCreatedAt: 1, fetchedAt: 1 }));
  }

  it("swaps to follows on the SAME sub id with author filters — no new socket", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, [followedPk]);

    engine.setFeedContext("follows");
    const filters = sockets[0].reqAllFilters("feed-global");
    expect(filters).toHaveLength(1);
    expect(filters?.[0]).toMatchObject({ kinds: [1], authors: [followedPk], limit: 50 });
    expect(sockets).toHaveLength(1); // still one connection
    engine.destroy();
  });

  it("chunks >500 follows into multiple filters on one REQ", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    const many = Array.from({ length: 501 }, (_, i) =>
      i.toString(16).padStart(64, "0"),
    );
    seedFollows(store, many);

    engine.setFeedContext("follows");
    const filters = sockets[0].reqAllFilters("feed-global");
    expect(filters).toHaveLength(2);
    expect((filters?.[0].authors as string[]).length).toBe(500);
    expect((filters?.[1].authors as string[]).length).toBe(1);
    engine.destroy();
  });

  it("closes the feed sub instead of degenerating to a bare filter on 0 follows", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, []);

    engine.setFeedContext("follows");
    const close = sockets[0].frames().find((f) => f[0] === "CLOSE" && f[1] === "feed-global");
    expect(close).toBeDefined();
    // The last feed REQ is still the global one — never an authorless follows REQ.
    const filters = sockets[0].reqAllFilters("feed-global");
    expect(filters?.[0].authors).toBeUndefined();
    expect(store.getState().feed.byContext.follows.status).toBe("live"); // empty state, not spinner
    engine.destroy();
  });

  it("filters non-followed stragglers out of follows batches", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, [followedPk]);
    engine.setFeedContext("follows");

    sockets[0].message(["EVENT", "feed-global", signed("late global straggler")]);
    sockets[0].message(["EVENT", "feed-global", signedBy(followedSk, "from a follow")]);
    await flush();

    const follows = store.getState().feed.byContext.follows;
    expect(follows.ids).toHaveLength(1);
    expect(follows.entities[follows.ids[0]].pubkey).toBe(followedPk);
    engine.destroy();
  });

  it("re-accepts an event for the other context after a swap (per-context dedup)", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, [followedPk]);
    engine.setFeedContext("follows");

    const note = signedBy(followedSk, "seen in follows first");
    sockets[0].message(["EVENT", "feed-global", note]);
    await flush();
    expect(store.getState().feed.byContext.follows.ids).toEqual([note.id]);

    // Back to global: the relay re-sends the same event for the new REQ.
    engine.setFeedContext("global");
    sockets[0].message(["EVENT", "feed-global", note]);
    await flush();
    expect(store.getState().feed.byContext.global.ids).toContain(note.id);
    engine.destroy();
  });

  it("cross-seeds the follows bucket from cached global events on switch", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const fromFollow = signedBy(followedSk, "already cached in global");
    sockets[0].message(["EVENT", "feed-global", fromFollow]);
    sockets[0].message(["EVENT", "feed-global", signed("stranger")]);
    await flush();
    seedFollows(store, [followedPk]);

    engine.setFeedContext("follows");
    expect(store.getState().feed.byContext.follows.ids).toEqual([fromFollow.id]);
    engine.destroy();
  });

  it("persists both snapshots and prunes the events store by the union", async () => {
    const { engine, store, sockets, dbs } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const globalNote = signed("global note");
    sockets[0].message(["EVENT", "feed-global", globalNote]);
    await flush();

    seedFollows(store, [followedPk]);
    engine.setFeedContext("follows");
    const followNote = signedBy(followedSk, "follow note");
    sockets[0].message(["EVENT", "feed-global", followNote]);
    await flush();

    engine.handleBackground();
    await flush();

    const db = dbs.get("thewired_app")!;
    const userState = db.tables.get("kv_user_state")!;
    expect(JSON.parse(userState.get("feed.global")!)).toContain(globalNote.id);
    expect(JSON.parse(userState.get("feed.follows")!)).toEqual([followNote.id]);
    // Union prune: both events survive in the shared events table.
    const eventKeys = [...db.tables.get("kv_events")!.keys()];
    expect(eventKeys).toContain(globalNote.id);
    expect(eventKeys).toContain(followNote.id);
    engine.destroy();
  });

  it("hydrates each context from its own snapshot", async () => {
    const globalNote = signed("cached global");
    const followNote = signedBy(followedSk, "cached follow");
    const db = new FakeDb("thewired_app");
    db.tables.set(
      "kv_events",
      new Map([
        [globalNote.id, JSON.stringify(globalNote)],
        [followNote.id, JSON.stringify(followNote)],
      ]),
    );
    db.tables.set(
      "kv_user_state",
      new Map([
        ["feed.global", JSON.stringify([globalNote.id])],
        ["feed.follows", JSON.stringify([followNote.id])],
      ]),
    );
    const dbs = new Map([["thewired_app", db]]);

    const { engine, store } = makeHarness({ dbs });
    await engine.start(null);
    expect(store.getState().feed.byContext.global.ids).toEqual([globalNote.id]);
    expect(store.getState().feed.byContext.follows.ids).toEqual([followNote.id]);
    engine.destroy();
  });

  it("fetches the kind-3 on start and fills the follows slice", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const req = sockets[0]
      .frames()
      .find(
        (f) =>
          f[0] === "REQ" &&
          (f[2] as { kinds?: number[] }).kinds?.[0] === 3 &&
          (f[2] as { authors?: string[] }).authors?.[0] === pubkey,
      );
    expect(req).toBeDefined();

    sockets[0].message(["EVENT", req![1], kind3By(secretKey, [followedPk])]);
    sockets[0].message(["EOSE", req![1]]);
    await new Promise((resolve) => setTimeout(resolve, 500)); // EOSE grace

    const follows = store.getState().follows;
    expect(follows.status).toBe("ready");
    expect(follows.pubkeys).toEqual([followedPk]);
    engine.destroy();
  });

  it("marks follows missing when relays return no kind-3", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && (f[2] as { kinds?: number[] }).kinds?.[0] === 3);
    sockets[0].message(["EOSE", req![1]]);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(store.getState().follows.status).toBe("missing");
    engine.destroy();
  });

  it("clears follows state on identity change before syncing the new account", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, [followedPk]);
    engine.setFeedContext("follows");
    const note = signedBy(followedSk, "old identity's follows feed");
    sockets[0].message(["EVENT", "feed-global", note]);
    await flush();
    expect(store.getState().feed.byContext.follows.ids).toHaveLength(1);

    await engine.setIdentity(pubkey);
    expect(store.getState().follows.status).toBe("loading"); // cleared, then re-fetching
    expect(store.getState().feed.byContext.follows.ids).toEqual([]);
    engine.destroy();
  });

  it("resubscribes on foreground with the ACTIVE context's watermark", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    seedFollows(store, [followedPk]);
    engine.setFeedContext("follows");

    const note = signedBy(followedSk, "watermark", 1_700_000_777);
    sockets[0].message(["EVENT", "feed-global", note]);
    await flush();

    engine.handleBackground();
    engine.handleForeground();
    // Suspend closed the socket — the fresh REQ replays when the new one opens.
    const current = sockets[sockets.length - 1];
    current.open();
    const filters = current.reqAllFilters("feed-global");
    expect(filters?.[0]).toMatchObject({ authors: [followedPk], since: 1_700_000_777 - 60 });
    engine.destroy();
  });

  it("publishNote lands optimistically in BOTH contexts", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    engine.publishNote("my note is always followed");
    await flush();

    const { feed } = store.getState();
    expect(feed.byContext.global.ids).toHaveLength(1);
    expect(feed.byContext.follows.ids).toEqual(feed.byContext.global.ids);
    engine.destroy();
  });
});

describe("engagement (kinds 7/6/replies + publishes)", () => {
  function reactionBy(sk: Uint8Array, targetId: string, content = "+"): NostrEvent {
    return finalizeEvent(
      {
        kind: 7,
        created_at: 1_700_000_000,
        tags: [["e", targetId], ["p", "someone"]],
        content,
      },
      sk,
    );
  }

  function repostBy(sk: Uint8Array, targetId: string): NostrEvent {
    return finalizeEvent(
      {
        kind: 6,
        created_at: 1_700_000_000,
        tags: [["e", targetId], ["p", "someone"]],
        content: "{}",
      },
      sk,
    );
  }

  function replyBy(sk: Uint8Array, rootId: string, content = "a reply"): NostrEvent {
    return finalizeEvent(
      {
        kind: 1,
        created_at: 1_700_000_000,
        tags: [["e", rootId, "", "root"], ["p", "someone"]],
        content,
      },
      sk,
    );
  }

  it("sends one engagement REQ with four OR'd filters; re-call replaces; CLOSE on unsubscribe", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    engine.subscribeEngagement(["a", "b"]);
    let filters = sockets[0].reqAllFilters("engagement");
    expect(filters?.map((f) => f.kinds)).toEqual([[7], [6], [1], [9735]]);
    for (const f of filters ?? []) expect(f["#e"]).toEqual(["a", "b"]);

    engine.subscribeEngagement(["c"]);
    filters = sockets[0].reqAllFilters("engagement");
    for (const f of filters ?? []) expect(f["#e"]).toEqual(["c"]);

    engine.unsubscribeEngagement();
    const close = sockets[0].frames().find((f) => f[0] === "CLOSE" && f[1] === "engagement");
    expect(close).toBeDefined();
    engine.destroy();
  });

  it("folds kind-7/6 deliveries into aggregates after the 50ms flush, deduped", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    engine.subscribeEngagement(["note-1"]);

    const reaction = reactionBy(generateSecretKey(), "note-1", "🔥");
    const repost = repostBy(generateSecretKey(), "note-1");
    sockets[0].message(["EVENT", "engagement", reaction]);
    sockets[0].message(["EVENT", "engagement", repost]);
    sockets[0].message(["EVENT", "engagement", reaction]); // redelivery
    await flush();

    const { engagement } = store.getState();
    expect(Object.keys(engagement.reactionsByTarget["note-1"] ?? {})).toEqual([reaction.id]);
    expect(Object.keys(engagement.repostsByTarget["note-1"] ?? {})).toEqual([repost.id]);
    engine.destroy();
  });

  it("counts an engagement-sub reply WITHOUT inserting it into the feed", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();
    engine.subscribeEngagement(["root-1"]);

    const reply = replyBy(generateSecretKey(), "root-1");
    sockets[0].message(["EVENT", "engagement", reply]);
    await flush();

    const state = store.getState();
    expect(state.engagement.repliesByTarget["root-1"]).toEqual([reply.id]);
    expect(state.feed.byContext.global.ids).not.toContain(reply.id);
    engine.destroy();
  });

  it("a FEED_SUB reply lands in both the feed and the reply index", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const reply = replyBy(generateSecretKey(), "root-2");
    sockets[0].message(["EVENT", "feed-global", reply]);
    await flush();

    const state = store.getState();
    expect(state.feed.byContext.global.ids).toContain(reply.id);
    expect(state.engagement.repliesByTarget["root-2"]).toEqual([reply.id]);
    engine.destroy();
  });

  it("publishReaction signs desktop-parity tags, lands optimistically, resolves on OK", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const target = signed("target note");
    const confirmed = engine.publishReaction(target);
    await flush();

    // Optimistic before any OK.
    expect(
      store.getState().engagement.reactionsByTarget[target.id],
    ).toBeDefined();

    const frame = sockets[0]
      .frames()
      .find((f) => f[0] === "EVENT" && (f[1] as NostrEvent).kind === 7);
    expect(frame).toBeDefined();
    const event = frame![1] as NostrEvent;
    expect(event.tags).toEqual([
      ["e", target.id],
      ["p", target.pubkey],
      ["k", "1"],
    ]);
    expect(event.content).toBe("+");
    expect(verifyEventSync(event)).toBe(true);

    sockets[0].message(["OK", event.id, true, ""]);
    await expect(confirmed).resolves.toBe(true);

    // Relay echo of our own reaction doesn't double-count.
    sockets[0].message(["EVENT", "engagement", event]);
    await flush();
    expect(
      Object.keys(store.getState().engagement.reactionsByTarget[target.id]),
    ).toHaveLength(1);
    engine.destroy();
  });

  it("publishRepost embeds the original and flips selectMyRepost", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const target = signed("repost me");
    const confirmed = engine.publishRepost(target);
    await flush();

    const frame = sockets[0]
      .frames()
      .find((f) => f[0] === "EVENT" && (f[1] as NostrEvent).kind === 6);
    const event = frame![1] as NostrEvent;
    expect(event.tags).toEqual([
      ["e", target.id],
      ["p", target.pubkey],
    ]);
    expect(JSON.parse(event.content).id).toBe(target.id);

    const { engagement } = store.getState();
    expect(Object.values(engagement.repostsByTarget[target.id] ?? {})).toContain(pubkey);

    sockets[0].message(["OK", event.id, true, ""]);
    await expect(confirmed).resolves.toBe(true);
    engine.destroy();
  });

  it("publishReply builds NIP-10 marked tags for a root-level reply and enters the feed", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const target = signed("root note");
    engine.publishReply("nice note", { eventId: target.id, pubkey: target.pubkey });
    await flush();

    const frame = sockets[0]
      .frames()
      .find(
        (f) =>
          f[0] === "EVENT" &&
          (f[1] as NostrEvent).kind === 1 &&
          (f[1] as NostrEvent).content === "nice note",
      );
    const event = frame![1] as NostrEvent;
    expect(event.tags).toEqual([
      ["e", target.id, "", "root"],
      ["p", target.pubkey],
    ]);

    const state = store.getState();
    expect(state.engagement.repliesByTarget[target.id]).toEqual([event.id]);
    expect(state.feed.byContext.global.ids).toContain(event.id);
    engine.destroy();
  });

  it("publishReply to a nested target tags root AND reply", async () => {
    const { engine, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const parent = signed("a reply somewhere in a thread");
    engine.publishReply("deep reply", {
      eventId: parent.id,
      pubkey: parent.pubkey,
      rootId: "thread-root",
    });
    await flush();

    const frame = sockets[0]
      .frames()
      .find(
        (f) =>
          f[0] === "EVENT" &&
          (f[1] as NostrEvent).kind === 1 &&
          (f[1] as NostrEvent).content === "deep reply",
      );
    const event = frame![1] as NostrEvent;
    expect(event.tags).toEqual([
      ["e", "thread-root", "", "root"],
      ["e", parent.id, "", "reply"],
      ["p", parent.pubkey],
    ]);
    engine.destroy();
  });

  it("guest publishes reject", async () => {
    const { engine } = makeHarness();
    await engine.start(null);
    const target = signed("target");
    await expect(engine.publishReaction(target)).rejects.toThrow("Sign in");
    await expect(engine.publishRepost(target)).rejects.toThrow("Sign in");
    await expect(
      engine.publishReply("x", { eventId: target.id, pubkey: target.pubkey }),
    ).rejects.toThrow("Sign in");
    engine.destroy();
  });
});

describe("thread cache (loadThread + optimistic replies)", () => {
  function replyTo(rootId: string, content: string, created_at = 1_700_000_100): NostrEvent {
    return finalizeEvent(
      {
        kind: 1,
        created_at,
        tags: [["e", rootId, "", "root"], ["p", "someone"]],
        content,
      },
      generateSecretKey(),
    );
  }

  it("REQs root + subtree + focus legs and fills the thread cache", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const root = signed("thread root", 1_700_000_000);
    const reply = replyTo(root.id, "a reply", 1_700_000_100);
    const promise = engine.loadThread(root.id, reply.id);

    expect(store.getState().threads.byRoot[root.id]?.status).toBe("loading");

    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    expect(req).toBeDefined();
    expect(req!.slice(2)).toEqual([
      { ids: [root.id] },
      { kinds: [1], "#e": [root.id], limit: 100 },
      { ids: [reply.id] },
      { kinds: [1], "#e": [reply.id], limit: 100 },
      { kinds: [7, 6, 9735], "#e": [root.id, reply.id], limit: 100 },
    ]);

    sockets[0].message(["EVENT", req![1], root]);
    sockets[0].message(["EVENT", req![1], reply]);
    sockets[0].message(["EOSE", req![1]]);
    await promise;

    const { threads } = store.getState();
    const entry = threads.byRoot[root.id];
    expect(entry?.status).toBe("ready");
    expect(entry?.truncated).toBe(false);
    expect(entry?.oldestReplyAt).toBe(reply.created_at);
    expect(entry?.events.map((e) => e.id)).toEqual([root.id, reply.id]);
    expect(threads.aliasToRoot[reply.id]).toBe(root.id);
    engine.destroy();
  });

  it("skips the focus legs when the focus IS the root", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const root = signed("root-focused thread");
    const promise = engine.loadThread(root.id);
    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    expect(req!.slice(2)).toEqual([
      { ids: [root.id] },
      { kinds: [1], "#e": [root.id], limit: 100 },
      { kinds: [7, 6, 9735], "#e": [root.id], limit: 100 },
    ]);
    sockets[0].message(["EOSE", req![1]]);
    await promise;
    engine.destroy();
  });

  it("flags truncation when the reply page comes back full", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const root = signed("busy thread", 1_699_000_000);
    const promise = engine.loadThread(root.id);
    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));

    sockets[0].message(["EVENT", req![1], root]);
    for (let i = 0; i < 100; i++) {
      sockets[0].message(["EVENT", req![1], replyTo(root.id, `r${i}`, 1_700_000_000 + i)]);
    }
    sockets[0].message(["EOSE", req![1]]);
    await promise;

    const entry = store.getState().threads.byRoot[root.id];
    expect(entry?.truncated).toBe(true);
    expect(entry?.oldestReplyAt).toBe(1_700_000_000);
    expect(entry?.events).toHaveLength(101);
    engine.destroy();
  });

  it("publishReply inserts optimistically into the thread cache (status stays idle)", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const target = signed("root note");
    engine.publishReply("optimistic reply", { eventId: target.id, pubkey: target.pubkey });
    await flush();

    const entry = store.getState().threads.byRoot[target.id];
    expect(entry?.events.map((e) => e.content)).toEqual(["optimistic reply"]);
    // Seeded only — a full loadThread is still owed for this conversation.
    expect(entry?.status).toBe("idle");
    engine.destroy();
  });

  it("publishReply to a nested target caches under the thread ROOT", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(pubkey);
    sockets[0].open();

    const parent = signed("mid-thread parent");
    engine.publishReply("deep optimistic", {
      eventId: parent.id,
      pubkey: parent.pubkey,
      rootId: "thread-root",
    });
    await flush();

    const { threads } = store.getState();
    expect(threads.byRoot["thread-root"]?.events).toHaveLength(1);
    expect(threads.byRoot[parent.id]).toBeUndefined();
    engine.destroy();
  });

  it("clears the thread cache on identity change", async () => {
    const { engine, store, sockets } = makeHarness({ signer: true });
    await engine.start(null);
    sockets[0].open();

    const target = signed("cached before switch");
    store.dispatch(threadEventsMerged({ rootId: target.id, events: [target] }));
    expect(store.getState().threads.byRoot[target.id]).toBeDefined();

    await engine.setIdentity(pubkey);
    expect(store.getState().threads.byRoot).toEqual({});
    engine.destroy();
  });

  it("merges live kind-1 arrivals into EXISTING thread entries only", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const root = signed("watched thread");
    store.dispatch(threadEventsMerged({ rootId: root.id, events: [root] }));

    const strayRoot = "f".repeat(64);
    sockets[0].message(["EVENT", "feed-global", replyTo(root.id, "live reply")]);
    sockets[0].message(["EVENT", "feed-global", replyTo(strayRoot, "stray reply")]);
    await flush();

    const { threads } = store.getState();
    expect(threads.byRoot[root.id]?.events.map((e) => e.content)).toEqual([
      "watched thread",
      "live reply",
    ]);
    // The existence guard: stray feed traffic never creates entries.
    expect(threads.byRoot[strayRoot]).toBeUndefined();
    engine.destroy();
  });

  it("pages older replies below the watermark; a short page clears truncated", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const root = signed("paged thread", 1_699_000_000);
    store.dispatch(threadEventsMerged({ rootId: root.id, events: [root] }));
    store.dispatch(threadFetchStarted({ rootId: root.id }));
    store.dispatch(
      threadFetchCompleted({
        rootId: root.id,
        fetchedAt: 1,
        truncated: true,
        oldestReplyAt: 1_700_000_000,
      }),
    );

    const promise = engine.loadOlderReplies(root.id);
    expect(store.getState().threads.byRoot[root.id]?.loadingOlder).toBe(true);

    const req = sockets[0]
      .frames()
      .find((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    expect(req!.slice(2)).toEqual([
      { kinds: [1], "#e": [root.id], until: 1_699_999_999, limit: 100 },
    ]);
    sockets[0].message(["EVENT", req![1], replyTo(root.id, "older reply", 1_699_500_000)]);
    sockets[0].message(["EOSE", req![1]]);
    await promise;

    const entry = store.getState().threads.byRoot[root.id]!;
    expect(entry.loadingOlder).toBe(false);
    expect(entry.truncated).toBe(false); // < 100 returned ⇒ exhausted
    expect(entry.oldestReplyAt).toBe(1_699_500_000);
    expect(entry.events.map((e) => e.content)).toContain("older reply");
    engine.destroy();
  });

  it("skips paging at the per-thread cap (merged pages would evict back out)", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(null);
    sockets[0].open();

    const rootId = "9".repeat(64);
    const bulk: NostrEvent[] = Array.from({ length: THREAD_EVENTS_CAP }, (_, i) => ({
      id: `${i}`.padStart(64, "0"),
      pubkey: "a".repeat(64),
      created_at: 1_700_000_000 + i,
      kind: 1,
      tags: [],
      content: `r${i}`,
      sig: "s",
    }));
    store.dispatch(threadEventsMerged({ rootId, events: bulk }));
    store.dispatch(threadFetchStarted({ rootId }));
    store.dispatch(
      threadFetchCompleted({
        rootId,
        fetchedAt: 1,
        truncated: true,
        oldestReplyAt: 1_700_000_000,
      }),
    );

    await engine.loadOlderReplies(rootId);
    const fetchReqs = sockets[0]
      .frames()
      .filter((f) => f[0] === "REQ" && String(f[1]).startsWith("fetch-"));
    expect(fetchReqs).toHaveLength(0);
    expect(store.getState().threads.byRoot[rootId]?.loadingOlder).toBe(false);
    engine.destroy();
  });
});
