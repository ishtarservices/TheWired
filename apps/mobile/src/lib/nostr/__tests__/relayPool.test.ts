import type { NostrEvent } from "@thewired/shared-types";

import { computeBackoff, createRelayPool, type RelayPoolCallbacks } from "../relayPool";
import type { WebSocketFactory, WebSocketLike } from "@/core/adapters";

// Controllable fake socket — tests drive open/close/message transitions.
class FakeSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // test drivers
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  serverClose(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" });
  }
  frames(): unknown[][] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

function makeFactory() {
  const sockets: FakeSocket[] = [];
  const factory: WebSocketFactory = {
    create() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
  return { factory, sockets };
}

function makeCallbacks(): RelayPoolCallbacks & {
  events: Array<[string, NostrEvent, string]>;
  eoses: Array<[string, string]>;
  statuses: Array<[string, string]>;
  oks: Array<[string, boolean]>;
} {
  const events: Array<[string, NostrEvent, string]> = [];
  const eoses: Array<[string, string]> = [];
  const statuses: Array<[string, string]> = [];
  const oks: Array<[string, boolean]> = [];
  return {
    events,
    eoses,
    statuses,
    oks,
    onEvent: (subId, event, url) => events.push([subId, event, url]),
    onEose: (subId, url) => eoses.push([subId, url]),
    onStatus: (url, status) => statuses.push([url, status]),
    onOk: (id, accepted) => oks.push([id, accepted]),
  };
}

const EVENT = { id: "e1", kind: 1, content: "hi" } as NostrEvent;

describe("computeBackoff", () => {
  it("grows exponentially and caps at 60s (±25% jitter)", () => {
    expect(computeBackoff(0)).toBeGreaterThanOrEqual(750);
    expect(computeBackoff(0)).toBeLessThanOrEqual(1250);
    expect(computeBackoff(3)).toBeGreaterThanOrEqual(6000);
    expect(computeBackoff(3)).toBeLessThanOrEqual(10_000);
    expect(computeBackoff(20)).toBeLessThanOrEqual(75_000);
  });
});

describe("relayPool", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends tracked REQs when a socket opens (subscribe-before-connect)", () => {
    const { factory, sockets } = makeFactory();
    const cbs = makeCallbacks();
    const pool = createRelayPool(factory, cbs);

    pool.connect(["wss://a"]);
    pool.subscribe("sub1", [{ kinds: [1], limit: 50 }]);
    expect(sockets[0].sent).toHaveLength(0); // still connecting

    sockets[0].open();
    expect(sockets[0].frames()).toContainEqual(["REQ", "sub1", { kinds: [1], limit: 50 }]);
    expect(cbs.statuses).toContainEqual(["wss://a", "connected"]);
  });

  it("routes EVENT / EOSE / OK frames", () => {
    const { factory, sockets } = makeFactory();
    const cbs = makeCallbacks();
    const pool = createRelayPool(factory, cbs);
    pool.connect(["wss://a"]);
    sockets[0].open();
    pool.subscribe("sub1", [{ kinds: [1] }]);

    sockets[0].message(["EVENT", "sub1", EVENT]);
    sockets[0].message(["EOSE", "sub1"]);
    sockets[0].message(["OK", "e1", true, ""]);

    expect(cbs.events).toEqual([["sub1", EVENT, "wss://a"]]);
    expect(cbs.eoses).toEqual([["sub1", "wss://a"]]);
    expect(cbs.oks).toEqual([["e1", true]]);
  });

  it("re-sends subscriptions after an unexpected close + backoff", () => {
    const { factory, sockets } = makeFactory();
    const cbs = makeCallbacks();
    const pool = createRelayPool(factory, cbs);
    pool.connect(["wss://a"]);
    sockets[0].open();
    pool.subscribe("sub1", [{ kinds: [1] }]);

    sockets[0].serverClose();
    expect(cbs.statuses).toContainEqual(["wss://a", "disconnected"]);

    jest.advanceTimersByTime(2000); // > max first backoff (1250ms)
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].frames()).toContainEqual(["REQ", "sub1", { kinds: [1] }]);
  });

  it("suspend closes sockets without reconnecting; resume reopens + resubscribes", () => {
    const { factory, sockets } = makeFactory();
    const cbs = makeCallbacks();
    const pool = createRelayPool(factory, cbs);
    pool.connect(["wss://a"]);
    sockets[0].open();
    pool.subscribe("sub1", [{ kinds: [1] }]);

    pool.suspend();
    expect(sockets[0].closed).toBe(true);

    jest.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1); // no reconnect while suspended

    pool.resume();
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(sockets[1].frames()).toContainEqual(["REQ", "sub1", { kinds: [1] }]);
  });

  it("re-subscribing an existing id replaces its filters on the wire", () => {
    const { factory, sockets } = makeFactory();
    const pool = createRelayPool(factory, makeCallbacks());
    pool.connect(["wss://a"]);
    sockets[0].open();

    pool.subscribe("feed", [{ kinds: [1], limit: 50 }]);
    pool.subscribe("feed", [{ kinds: [1], since: 123, limit: 50 }]);

    const reqs = sockets[0].frames().filter((f) => f[0] === "REQ");
    expect(reqs).toHaveLength(2);
    expect(reqs[1][2]).toEqual({ kinds: [1], since: 123, limit: 50 });
  });

  it("unsubscribe sends CLOSE and stops replaying the sub on reconnect", () => {
    const { factory, sockets } = makeFactory();
    const pool = createRelayPool(factory, makeCallbacks());
    pool.connect(["wss://a"]);
    sockets[0].open();
    pool.subscribe("sub1", [{ kinds: [1] }]);
    pool.unsubscribe("sub1");

    expect(sockets[0].frames()).toContainEqual(["CLOSE", "sub1"]);

    sockets[0].serverClose();
    jest.advanceTimersByTime(2000);
    sockets[1].open();
    expect(sockets[1].frames().filter((f) => f[0] === "REQ")).toHaveLength(0);
  });

  it("queues publishes while connecting and flushes them on open", () => {
    const { factory, sockets } = makeFactory();
    const pool = createRelayPool(factory, makeCallbacks());
    pool.connect(["wss://a"]);

    pool.publish(EVENT);
    expect(sockets[0].sent).toHaveLength(0);

    sockets[0].open();
    expect(sockets[0].frames()).toContainEqual(["EVENT", EVENT]);
  });

  it("reconnectNow skips the remaining backoff", () => {
    const { factory, sockets } = makeFactory();
    const pool = createRelayPool(factory, makeCallbacks());
    pool.connect(["wss://a"]);
    sockets[0].open();
    sockets[0].serverClose(); // schedules ~1s backoff

    pool.reconnectNow();
    expect(sockets).toHaveLength(2); // dialed immediately

    // The pending backoff timer must not double-dial later.
    jest.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(2);
  });

  it("destroy closes everything and stops timers", () => {
    const { factory, sockets } = makeFactory();
    const pool = createRelayPool(factory, makeCallbacks());
    pool.connect(["wss://a", "wss://b"]);
    sockets[0].open();
    pool.destroy();

    expect(sockets[0].closed).toBe(true);
    jest.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(2); // no new dials
  });
});
