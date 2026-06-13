import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { relayManager } from "../relayManager";
import { BOOTSTRAP_RELAYS } from "../constants";

// Reuse the same MockWebSocket shape as relayConnection.test.ts so we can drive
// connect → open and inspect what reached the wire.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {}
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = MockWebSocket.CLOSED; }
  simulateOpen() { this.readyState = MockWebSocket.OPEN; this.onopen?.(); }
}

let mockWsInstances: MockWebSocket[] = [];

function countREQs(ws: MockWebSocket): number {
  return ws.sent.map((s) => JSON.parse(s)).filter((m) => m[0] === "REQ").length;
}

beforeEach(() => {
  mockWsInstances = [];
  vi.stubGlobal(
    "WebSocket",
    class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWsInstances.push(this);
      }
    },
  );
  // NIP-11 fetch is fire-and-forget; make it reject fast so no real network hit.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no nip11")));
  relayManager.disconnectAll(); // reset singleton state from prior tests
});

afterEach(() => {
  relayManager.disconnectAll();
  vi.restoreAllMocks();
});

describe("relayManager — broadcast sub forwarding (#24)", () => {
  it("forwards a no-URL broadcast sub to a read relay that connects AFTER subscribe", () => {
    // Relay is dialed but not yet open.
    relayManager.connect("wss://late.relay", "read");
    const ws = mockWsInstances[mockWsInstances.length - 1];

    // Broadcast sub (no relayUrls) created while the relay is still "connecting":
    // getReadRelays() (connected-only) is empty, so nothing is sent immediately —
    // PRE-fix this REQ was then lost to that relay forever.
    relayManager.subscribe({ filters: [{ kinds: [1] }], onEvent: vi.fn() });
    expect(countREQs(ws)).toBe(0);

    // When the relay finishes connecting, the broadcast sub is forwarded.
    ws.simulateOpen();
    expect(countREQs(ws)).toBeGreaterThanOrEqual(1);
  });
});

describe("relayManager — disconnectAll clears pending + callbacks (#80)", () => {
  it("a relay connecting after disconnectAll forwards nothing stale", () => {
    relayManager.subscribe({ filters: [{ kinds: [1] }], onEvent: vi.fn() }); // broadcast pending

    // Tear down (logout / account switch). PRE-fix this left the pending
    // broadcast + its onEvent callback registered.
    relayManager.disconnectAll();

    // A fresh relay connects — nothing from the previous session should forward.
    relayManager.connect("wss://fresh.relay", "read");
    const ws = mockWsInstances[mockWsInstances.length - 1];
    ws.simulateOpen();
    expect(countREQs(ws)).toBe(0);
  });
});

describe("relayManager — URL normalization", () => {
  it("treats trailing-slash and bare URLs as one connection", () => {
    relayManager.connect("wss://a.example/");
    relayManager.connect("wss://a.example");
    expect(relayManager.getAllConnections().size).toBe(1);
    expect(mockWsInstances.length).toBe(1);

    relayManager.disconnect("wss://a.example/");
    expect(relayManager.getAllConnections().size).toBe(0);
  });
});

describe("relayManager — reconcileUserRelays", () => {
  it("connects new entries and disconnects dropped ones, firing onRelayRemoved", () => {
    const removed: string[] = [];
    relayManager.setGlobalCallbacks({ onRelayRemoved: (url) => removed.push(url) });

    relayManager.reconcileUserRelays([
      { url: "wss://one.example", mode: "read+write" },
      { url: "wss://two.example", mode: "read" },
    ]);
    expect(relayManager.getAllConnections().has("wss://one.example")).toBe(true);
    expect(relayManager.getAllConnections().has("wss://two.example")).toBe(true);

    relayManager.reconcileUserRelays([{ url: "wss://one.example", mode: "read+write" }]);
    expect(relayManager.getAllConnections().has("wss://two.example")).toBe(false);
    expect(removed).toContain("wss://two.example");
  });

  it("recreates the connection when an entry's mode changes and re-sends subs", () => {
    relayManager.reconcileUserRelays([{ url: "wss://m.example", mode: "read" }]);
    const first = mockWsInstances[mockWsInstances.length - 1];
    first.simulateOpen();

    // One targeted + one broadcast sub live on the relay.
    relayManager.subscribe({
      filters: [{ kinds: [9] }],
      relayUrls: ["wss://m.example"],
      onEvent: vi.fn(),
    });
    relayManager.subscribe({ filters: [{ kinds: [1] }], onEvent: vi.fn() });
    expect(countREQs(first)).toBe(2);

    relayManager.reconcileUserRelays([{ url: "wss://m.example", mode: "read+write" }]);
    const second = mockWsInstances[mockWsInstances.length - 1];
    expect(second).not.toBe(first);
    expect(relayManager.getAllConnections().get("wss://m.example")?.mode).toBe("read+write");

    // Both pending subs are forwarded to the recreated connection on open.
    second.simulateOpen();
    expect(countREQs(second)).toBe(2);
  });

  it("never dials a locally-disabled relay and disconnects it if connected", () => {
    relayManager.reconcileUserRelays([{ url: "wss://d.example", mode: "read+write" }]);
    expect(relayManager.getAllConnections().has("wss://d.example")).toBe(true);

    relayManager.setUserDisabledRelays(["wss://d.example/"]); // normalized match
    relayManager.reconcileUserRelays([{ url: "wss://d.example", mode: "read+write" }]);
    expect(relayManager.getAllConnections().has("wss://d.example")).toBe(false);

    // connectFromConfig honors the disable too.
    relayManager.connectFromConfig([{ url: "wss://d.example", mode: "read+write" }]);
    expect(relayManager.getAllConnections().has("wss://d.example")).toBe(false);

    // Raw connect() stays permissive (transient feature dials).
    relayManager.connect("wss://d.example");
    expect(relayManager.getAllConnections().has("wss://d.example")).toBe(true);
  });

  it("pruneBootstrap disconnects bootstrap relays absent from a non-empty list", () => {
    relayManager.connectToBootstrap();
    const bootstrapCount = relayManager.getAllConnections().size;
    expect(bootstrapCount).toBe(BOOTSTRAP_RELAYS.length);

    const keep = BOOTSTRAP_RELAYS[0];
    relayManager.reconcileUserRelays(
      [{ url: keep, mode: "read+write" }],
      { pruneBootstrap: true },
    );
    expect(relayManager.getAllConnections().size).toBe(1);
    expect(relayManager.getAllConnections().has(keep)).toBe(true);
  });

  it("an empty list never prunes bootstrap", () => {
    relayManager.connectToBootstrap();
    relayManager.reconcileUserRelays([], { pruneBootstrap: true });
    expect(relayManager.getAllConnections().size).toBe(BOOTSTRAP_RELAYS.length);
  });

  it("disconnectAll clears the user list and disabled set", () => {
    relayManager.setUserDisabledRelays(["wss://d.example"]);
    relayManager.reconcileUserRelays([{ url: "wss://one.example", mode: "read+write" }]);
    relayManager.disconnectAll();

    // Previously-disabled relay connects again via config (set was cleared)…
    relayManager.connectFromConfig([{ url: "wss://d.example", mode: "read+write" }]);
    expect(relayManager.getAllConnections().has("wss://d.example")).toBe(true);

    // …and a reconcile doesn't try to disconnect relays from the old list.
    const removed: string[] = [];
    relayManager.setGlobalCallbacks({ onRelayRemoved: (url) => removed.push(url) });
    relayManager.reconcileUserRelays([{ url: "wss://d.example", mode: "read+write" }]);
    expect(removed).not.toContain("wss://one.example");
  });
});
