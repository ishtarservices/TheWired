import { generateSecretKey, getPublicKey } from "nostr-tools";
import { finalizeEvent } from "nostr-tools/pure";
import {
  createGiftWrappedDM,
  createSelfWrap,
  buildRumor,
  type GiftWrapContext,
} from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

import { createNostrEngine } from "../engine";
import { DM_SUB, GIFT_WRAP_LOOKBACK_SEC, resolveHexPubkey } from "../dmEngine";
import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { createSqliteStorage, type SqlDatabase } from "@/platform/adapters/sqliteStorage";
import { verifyEventSync } from "../verifyEvent";
import { createStore } from "@/store";
import { userMuted } from "@/store/slices/moderationSlice";

// DM engine harness: real store, real SQLite adapter over an in-memory fake,
// real @thewired/core gift-wrap crypto, fake sockets (url-tagged so the
// one-shot peer-relay socket is observable).

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public readonly url: string) {}
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

const mySecret = generateSecretKey();
const myPubkey = getPublicKey(mySecret);
const peerSecret = generateSecretKey();
const peerPubkey = getPublicKey(peerSecret);

function peerCtx(): GiftWrapContext {
  return { myPubkey: peerPubkey, signer: new LocalNsecSigner(peerSecret) };
}

function makeHarness(opts: { dbs?: Map<string, FakeDb> } = {}) {
  const sockets: FakeSocket[] = [];
  const dbs = opts.dbs ?? new Map<string, FakeDb>();
  const storage = createSqliteStorage(async (name) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb(name));
    return dbs.get(name)!;
  });
  const adapters: PlatformAdapters = {
    ws: {
      create(url: string) {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    },
    verifier: { verify: async (event) => verifyEventSync(event) },
    storage,
    signer: new LocalNsecSigner(mySecret),
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
  return { engine, store, sockets, dbs, adapters };
}

const flush = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

async function wrapFromPeer(content: string): Promise<NostrEvent> {
  const { wrap } = await createGiftWrappedDM(peerCtx(), content, myPubkey);
  return wrap;
}

describe("dm gift-wrap subscription + watermark", () => {
  it("first start subscribes with a bounded backlog (limit, no since)", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();
    const filter = sockets[0].reqFilters(DM_SUB);
    expect(filter).toBeDefined();
    expect(filter!.kinds).toEqual([1059]);
    expect(filter!["#p"]).toEqual([myPubkey]);
    expect(filter!.since).toBeUndefined();
    expect(filter!.limit).toBe(100);
    engine.destroy();
  });

  it("EOSE advances the watermark; foreground resubscribes with watermark − 3d", async () => {
    const { engine, sockets, dbs } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    const before = Math.floor(Date.now() / 1000);
    sockets[0].message(["EOSE", DM_SUB]);
    await flush();

    // Watermark persisted to the per-account DB.
    const accountDb = dbs.get(`thewired_${myPubkey}`)!;
    const persisted = accountDb.tables.get("kv_dm_state")?.get("lastGiftWrapEose");
    expect(persisted).toBeDefined();
    const wm = JSON.parse(persisted!) as number;
    expect(wm).toBeGreaterThanOrEqual(before);

    engine.handleBackground();
    engine.handleForeground();
    const reopened = sockets[sockets.length - 1];
    reopened.open();

    const filter = reopened.reqFilters(DM_SUB);
    // NIP-17 randomizes wrap timestamps up to 2 days back — the lookback
    // must cover that window or suspended-time wraps are lost.
    expect(filter!.since).toBe(wm - GIFT_WRAP_LOOKBACK_SEC);
    expect(filter!.limit).toBeUndefined();
    engine.destroy();
  });

  it("relaunch resubscribes from the persisted watermark", async () => {
    const dbs = new Map<string, FakeDb>();
    const first = makeHarness({ dbs });
    await first.engine.start(myPubkey);
    first.sockets[0].open();
    first.sockets[0].message(["EOSE", DM_SUB]);
    await flush();
    first.engine.destroy();

    const second = makeHarness({ dbs });
    await second.engine.start(myPubkey);
    second.sockets[0].open();
    const filter = second.sockets[0].reqFilters(DM_SUB);
    expect(typeof filter!.since).toBe("number");
    expect((filter!.since as number) + GIFT_WRAP_LOOKBACK_SEC).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 1,
    );
    second.engine.destroy();
  });
});

describe("dm receive path", () => {
  it("unwraps a live wrap into a conversation + persists it", async () => {
    const { engine, store, sockets, dbs } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    sockets[0].message(["EVENT", DM_SUB, await wrapFromPeer("hi from the peer")]);
    await flush();

    const dm = store.getState().dm;
    expect(dm.conversations).toHaveLength(1);
    expect(dm.conversations[0].pubkey).toBe(peerPubkey);
    expect(dm.conversations[0].unreadCount).toBe(1);
    expect(dm.messages[peerPubkey][0].content).toBe("hi from the peer");

    // Rumor persisted locally (write-through) in the per-account DB.
    const accountDb = dbs.get(`thewired_${myPubkey}`)!;
    const persisted = [...(accountDb.tables.get("kv_dm_messages")?.values() ?? [])];
    expect(persisted.some((v) => v.includes("hi from the peer"))).toBe(true);
    engine.destroy();
  });

  it("drops forged wraps, foreign-recipient wraps, and typed wraps", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    // Forged signature → verify fails closed.
    const forged = { ...(await wrapFromPeer("forged")), sig: "0".repeat(128) };
    sockets[0].message(["EVENT", DM_SUB, forged]);

    // Addressed to someone else → not ours to decrypt.
    const other = await createGiftWrappedDM(peerCtx(), "not for you", getPublicKey(generateSecretKey()));
    sockets[0].message(["EVENT", DM_SUB, other.wrap]);

    // Typed wrap (friend request) → not a 1:1 message.
    const typed = await createGiftWrappedDM(peerCtx(), "be my friend", myPubkey, [
      ["type", "friend_request"],
    ]);
    sockets[0].message(["EVENT", DM_SUB, typed.wrap]);

    await flush();
    expect(store.getState().dm.conversations).toHaveLength(0);
    engine.destroy();
  });

  it("drops wraps from blocked senders", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(myPubkey);
    store.dispatch(userMuted(peerPubkey));
    sockets[0].open();

    sockets[0].message(["EVENT", DM_SUB, await wrapFromPeer("you blocked me")]);
    await flush();
    expect(store.getState().dm.conversations).toHaveLength(0);
    engine.destroy();
  });

  it("routes an own self-wrap (other-device echo) to the peer conversation", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    const myCtx: GiftWrapContext = { myPubkey, signer: new LocalNsecSigner(mySecret) };
    const rumor = await buildRumor(myPubkey, peerPubkey, "sent from my desktop");
    const { wrap: selfWrap } = await createSelfWrap(myCtx, "sent from my desktop", peerPubkey, undefined, rumor);
    sockets[0].message(["EVENT", DM_SUB, selfWrap]);
    await flush();

    const dm = store.getState().dm;
    expect(dm.conversations[0]?.pubkey).toBe(peerPubkey);
    expect(dm.conversations[0]?.unreadCount).toBe(0); // own message
    expect(dm.messages[peerPubkey][0].senderPubkey).toBe(myPubkey);
    engine.destroy();
  });

  it("kill+relaunch hydrates conversations from SQLite before the socket opens", async () => {
    const dbs = new Map<string, FakeDb>();
    const first = makeHarness({ dbs });
    await first.engine.start(myPubkey);
    first.sockets[0].open();
    const wrap = await wrapFromPeer("survives relaunch");
    first.sockets[0].message(["EVENT", DM_SUB, wrap]);
    await flush();
    first.engine.destroy();

    const second = makeHarness({ dbs });
    await second.engine.start(myPubkey);
    // Hydrated before any socket opened.
    expect(second.sockets[0].readyState).toBe(0);
    const dm = second.store.getState().dm;
    expect(dm.messages[peerPubkey][0].content).toBe("survives relaunch");
    expect(dm.conversations[0].pubkey).toBe(peerPubkey);

    // Live redelivery of the same wrap is deduped after hydration.
    second.sockets[0].open();
    second.sockets[0].message(["EVENT", DM_SUB, wrap]);
    await flush();
    expect(second.store.getState().dm.messages[peerPubkey]).toHaveLength(1);
    second.engine.destroy();
  });
});

describe("dm send path", () => {
  it("optimistically inserts pending, publishes both wraps, resolves sent on OK", async () => {
    const { engine, store, sockets } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    await engine.sendDM(peerPubkey, "hello peer");
    const dm = store.getState().dm;
    expect(dm.messages[peerPubkey]).toHaveLength(1);
    expect(dm.messages[peerPubkey][0].status).toBe("pending");
    expect(dm.messages[peerPubkey][0].content).toBe("hello peer");

    // Two kind-1059 EVENT frames left the pool: recipient wrap + self wrap.
    const events = sockets[0]
      .frames()
      .filter((f) => f[0] === "EVENT")
      .map((f) => f[1] as NostrEvent)
      .filter((e) => e.kind === 1059);
    expect(events).toHaveLength(2);
    const recipients = events.map((e) => e.tags.find((t) => t[0] === "p")?.[1]).sort();
    expect(recipients).toEqual([myPubkey, peerPubkey].sort());
    // Ciphertext only — plaintext never crosses the socket.
    expect(events.every((e) => !e.content.includes("hello peer"))).toBe(true);

    const recipientWrap = events.find(
      (e) => e.tags.find((t) => t[0] === "p")?.[1] === peerPubkey,
    )!;
    sockets[0].message(["OK", recipientWrap.id, true, ""]);
    await flush();
    expect(store.getState().dm.messages[peerPubkey][0].status).toBe("sent");
    engine.destroy();
  });

  it("delivers to the peer's kind-10050 relay via a one-shot socket that closes after OK", async () => {
    const { engine, sockets } = makeHarness();
    await engine.start(myPubkey);
    sockets[0].open();

    await engine.sendDM(peerPubkey, "meet me on your inbox relay");
    await flush(50);

    // Answer the 10050 lookup with the peer's DM relay list. (The engine also
    // fetches OUR OWN 10050 at start — match the peer-authors query.)
    const req = sockets[0]
      .frames()
      .find(
        (f) =>
          f[0] === "REQ" &&
          JSON.stringify((f[2] as { authors?: string[] }).authors) === JSON.stringify([peerPubkey]),
      );
    expect(req).toBeDefined();
    const relayList = finalizeEvent(
      {
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["relay", "wss://inbox.peer.example"]],
        content: "",
      },
      peerSecret,
    );
    sockets[0].message(["EVENT", req![1], relayList]);
    sockets[0].message(["EOSE", req![1]]);
    // fetchEvents keeps collecting for a 350ms post-EOSE grace window.
    await flush(500);

    // One extra socket dialed the peer relay (not added to the resting set).
    const oneShot = sockets.find((s) => s.url === "wss://inbox.peer.example");
    expect(oneShot).toBeDefined();
    oneShot!.open();
    const frame = oneShot!.frames().find((f) => f[0] === "EVENT");
    expect(frame).toBeDefined();
    const wrap = frame![1] as NostrEvent;
    expect(wrap.kind).toBe(1059);
    expect(wrap.tags).toContainEqual(["p", peerPubkey]);

    oneShot!.message(["OK", wrap.id, true, ""]);
    await flush(20);
    expect(oneShot!.readyState).toBe(3); // closed right after the OK
    engine.destroy();
  });

  it("rejects sending without content or to yourself", async () => {
    const { engine } = makeHarness();
    await engine.start(myPubkey);
    await expect(engine.sendDM(peerPubkey, "   ")).rejects.toThrow(/message/i);
    await expect(engine.sendDM(myPubkey, "hi me")).rejects.toThrow(/you/i);
    engine.destroy();
  });
});

describe("resolveHexPubkey", () => {
  it("accepts hex and npub, rejects junk", () => {
    expect(resolveHexPubkey(myPubkey.toUpperCase())).toBe(myPubkey);
    expect(() => resolveHexPubkey("npub1junk")).toThrow();
    expect(() => resolveHexPubkey("not a key")).toThrow();
  });
});
