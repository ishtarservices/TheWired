import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { relayManager } from "../relayManager";

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
