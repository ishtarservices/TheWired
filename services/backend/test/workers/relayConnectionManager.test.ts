import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceRelays } from "../../src/db/schema/relays.js";
import { getRedis } from "../../src/lib/redis.js";
import { config } from "../../src/config.js";

/**
 * Deterministic tests for the multi-relay manager using a controllable mock
 * WebSocket + short (env-shrunk) timers + the real test DB. Covers: the
 * behavior-preserving own-relay path (regression), scoped external subs, the
 * reconcile diff, reconnect/backoff, the flood rate cap, and per-relay cursors.
 */

// ── Mock WebSocket the manager will instantiate ──────────────────────────
type Listener = (ev?: unknown) => void;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = MockWebSocket.CLOSED;
    this.fire("close");
  }
  private fire(type: string, ev?: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.fire("open");
  }
  simulateMessage(arr: unknown[]) {
    this.fire("message", { data: JSON.stringify(arr) });
  }
}

function reqFrames(ws: MockWebSocket): unknown[][] {
  return ws.sent.map((s) => JSON.parse(s)).filter((m) => m[0] === "REQ");
}

let stopFn: (() => void) | null = null;

async function startManager() {
  const { startRelayIngester } = await import("../../src/workers/relayConnectionManager.js");
  const handle = startRelayIngester();
  stopFn = handle.stop;
  return handle;
}

/** Resolve pending microtasks (open-handler awaits redis + fetch). */
const tick = () => new Promise((r) => setTimeout(r, 5));

async function insertSpaceWithRelay(spaceId: string, relayUrl: string, status = "approved") {
  await db.insert(spaces).values({
    id: spaceId,
    name: spaceId,
    hostRelay: relayUrl,
    createdAt: Date.now(),
    ingestionTier: "discovery",
  });
  await db.insert(spaceRelays).values({ relayUrl, spaceId, status, registeredBy: "creator" });
}

beforeAll(() => {
  // Real fetch is stubbed to a NIP-11 doc with a relay pubkey.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ pubkey: "relaykey" }) })),
  );
});

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // Shrink timers/caps so the test runs in real time without long waits.
  process.env.INGEST_REFRESH_MS = "40";
  process.env.INGEST_RECONNECT_MS = "30";
  process.env.INGEST_RATE_MAX = "5";
  process.env.INGEST_RATE_WINDOW_MS = "10000";
});

afterEach(() => {
  stopFn?.();
  stopFn = null;
  delete process.env.INGEST_REFRESH_MS;
  delete process.env.INGEST_RECONNECT_MS;
  delete process.env.INGEST_RATE_MAX;
});

function ownWs(): MockWebSocket {
  return MockWebSocket.instances.find((w) => w.url === config.relayUrl)!;
}
function wsFor(url: string): MockWebSocket | undefined {
  return MockWebSocket.instances.find((w) => w.url === url);
}

/** Poll until the manager has opened the mock socket for `url`. Sockets are
 *  created after an async DB read, so racing a fixed `tick()` is flaky on slow
 *  CI; this resolves as soon as the socket exists, or throws on timeout (so a
 *  genuine "never opened" regression still fails — just deterministically). */
async function waitForWs(url: string, timeoutMs = 2000): Promise<MockWebSocket> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ws = wsFor(url);
    if (ws) return ws;
    if (Date.now() >= deadline) {
      throw new Error(`mock WebSocket for ${url} was never opened within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("relay manager — regression (own relay)", () => {
  it("with NO registered relays, opens exactly the own relay with the two legacy REQs", async () => {
    await startManager();
    await waitForWs(config.relayUrl);

    expect(MockWebSocket.instances).toHaveLength(1);
    const own = ownWs();
    expect(own.url).toBe(config.relayUrl);

    own.simulateOpen();
    await tick();

    const reqs = reqFrames(own);
    expect(reqs.map((r) => r[1])).toEqual(["ingester", "ingester-music-backfill"]);
    // Main sub carries the full legacy kind set; backfill is music-only.
    expect((reqs[0][2] as { kinds: number[] }).kinds).toContain(9);
    expect((reqs[1][2] as { kinds: number[] }).kinds).toEqual([31683, 33123]);
  });
});

describe("relay manager — external relays", () => {
  it("opens a scoped connection per registered relay (collapsing its spaces)", async () => {
    await insertSpaceWithRelay("spaceA", "wss://ext.example");
    await insertSpaceWithRelay("spaceB", "wss://ext.example"); // same relay → one connection
    await startManager();

    const ext = await waitForWs("wss://ext.example");
    ext.simulateOpen();
    await tick();

    const reqs = reqFrames(ext);
    const chat = reqs.find((r) => r[1] === "ext-chat")![2] as { kinds: number[]; "#h": string[] };
    expect(chat.kinds).toEqual([9, 7]);
    expect(new Set(chat["#h"])).toEqual(new Set(["spaceA", "spaceB"]));
    const meta = reqs.find((r) => r[1] === "ext-meta")![2] as { kinds: number[] };
    expect(meta.kinds).toEqual([39000, 39002]);
  });

  it("reconcile: closes a connection when its registration is removed", async () => {
    await insertSpaceWithRelay("spaceA", "wss://ext.gone");
    await startManager();
    const ext = await waitForWs("wss://ext.gone");
    expect(ext.closed).toBe(false);

    // Drop the registration; the 40ms refresh loop should close it.
    await db.delete(spaceRelays).where(eq(spaceRelays.relayUrl, "wss://ext.gone"));
    await new Promise((r) => setTimeout(r, 80));
    expect(ext.closed).toBe(true);
  });

  it("reconnects after a drop (with backoff)", async () => {
    await insertSpaceWithRelay("spaceA", "wss://ext.flap");
    await startManager();
    const first = await waitForWs("wss://ext.flap");

    first.simulateOpen();
    await tick();
    first.close(); // server drops us
    // backoff is 30ms → a new socket to the same url should appear
    await new Promise((r) => setTimeout(r, 80));
    const sockets = MockWebSocket.instances.filter((w) => w.url === "wss://ext.flap");
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });
});

describe("relay manager — flood rate cap", () => {
  it("drops + flags a relay that exceeds the event cap", async () => {
    await insertSpaceWithRelay("spaceA", "wss://ext.flood");
    await startManager();
    const ext = await waitForWs("wss://ext.flood");
    ext.simulateOpen();
    await tick();

    // Cap is 5 (env). Send 7 events → the 6th trips it and closes the socket.
    for (let i = 0; i < 7; i++) {
      ext.simulateMessage(["EVENT", "ext-chat", { id: `e${i}`, pubkey: "p", kind: 9, created_at: 1, tags: [["h", "spaceA"]], content: "", sig: "s" }]);
    }
    expect(ext.closed).toBe(true);

    const [row] = await db.select().from(spaceRelays).where(eq(spaceRelays.relayUrl, "wss://ext.flood"));
    expect(row.errorCount).toBeGreaterThan(0);
    expect(row.lastError).toContain("rate cap");
  });
});

describe("relay manager — per-relay cursor", () => {
  it("advances the relay's own since-cursor on events", async () => {
    await insertSpaceWithRelay("spaceA", "wss://ext.cursor");
    await startManager();
    const ext = await waitForWs("wss://ext.cursor");
    ext.simulateOpen();
    await tick();

    ext.simulateMessage(["EVENT", "ext-chat", { id: "e1", pubkey: "relaykey", kind: 9, created_at: 1234567, tags: [["h", "spaceA"]], content: "", sig: "s" }]);
    await tick();

    const key = `ingester:last_seen:${Buffer.from("wss://ext.cursor").toString("base64url")}`;
    expect(await getRedis().get(key)).toBe("1234567");
    // The own-relay cursor key is untouched (separate from externals).
    expect(await getRedis().get("ingester:last_seen")).not.toBe("1234567");
  });
});
