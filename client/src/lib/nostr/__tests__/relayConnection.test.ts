import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayConnection } from "../relayConnection";
import { StormDetector } from "../reconnect";

/**
 * Minimal mock WebSocket that tracks sent messages and lets tests
 * trigger onopen / onmessage / onclose from the outside.
 */
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

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Helper: simulate the server accepting the connection */
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Helper: simulate the server sending a message */
  simulateMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Helper: simulate the connection dropping */
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

/** Parse sent messages back into arrays for assertion */
function parseSent(ws: MockWebSocket): unknown[][] {
  return ws.sent.map((s) => JSON.parse(s));
}

/** Count REQ messages in sent history */
function countREQs(ws: MockWebSocket): number {
  return parseSent(ws).filter((m) => m[0] === "REQ").length;
}

/** Get unique sub IDs from REQ messages */
function reqSubIds(ws: MockWebSocket): string[] {
  return parseSent(ws)
    .filter((m) => m[0] === "REQ")
    .map((m) => m[1] as string);
}

let mockWsInstances: MockWebSocket[] = [];

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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createConn(url = "wss://test.relay"): RelayConnection {
  return new RelayConnection(url, "read+write", new StormDetector());
}

function latestWs(): MockWebSocket {
  return mockWsInstances[mockWsInstances.length - 1];
}

// ---------------------------------------------------------------------------
// Core subscription lifecycle
// ---------------------------------------------------------------------------

describe("RelayConnection", () => {
  describe("subscribe while connected", () => {
    it("sends REQ immediately when websocket is open", () => {
      const conn = createConn();
      conn.connect();
      latestWs().simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1], limit: 10 }]);

      const reqs = parseSent(latestWs()).filter((m) => m[0] === "REQ");
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toEqual(["REQ", "sub-1", { kinds: [1], limit: 10 }]);
    });

    it("tracks subscription as active", () => {
      const conn = createConn();
      conn.connect();
      latestWs().simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      expect(conn.hasSubscription("sub-1")).toBe(true);
    });
  });

  describe("subscribe while disconnected (no double-send)", () => {
    it("does NOT queue REQ in the message queue", () => {
      const conn = createConn();
      conn.connect();
      // WebSocket is CONNECTING but not yet open
      conn.subscribe("sub-1", [{ kinds: [1] }]);

      // Nothing sent yet (ws not open)
      expect(latestWs().sent).toHaveLength(0);
    });

    it("sends exactly one REQ per sub when connection opens", () => {
      const conn = createConn();
      conn.connect();

      // Subscribe 3 times while not yet connected
      conn.subscribe("sub-1", [{ kinds: [1] }]);
      conn.subscribe("sub-2", [{ kinds: [3] }]);
      conn.subscribe("sub-3", [{ kinds: [7] }]);

      // Now connection opens — flushQueue + resubscribe fire
      latestWs().simulateOpen();

      // Each sub should appear exactly ONCE, not twice
      const ids = reqSubIds(latestWs());
      expect(ids.filter((id) => id === "sub-1")).toHaveLength(1);
      expect(ids.filter((id) => id === "sub-2")).toHaveLength(1);
      expect(ids.filter((id) => id === "sub-3")).toHaveLength(1);
      expect(countREQs(latestWs())).toBe(3);
    });

    it("does not send a closed subscription on connect", () => {
      const conn = createConn();
      conn.connect();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      conn.subscribe("sub-2", [{ kinds: [3] }]);
      conn.closeSubscription("sub-1"); // close before connect

      latestWs().simulateOpen();

      const ids = reqSubIds(latestWs());
      expect(ids).not.toContain("sub-1");
      expect(ids).toContain("sub-2");
    });
  });

  describe("reconnect resubscribes", () => {
    it("re-sends active subscriptions on reconnect", () => {
      const conn = createConn();
      conn.connect();
      const ws1 = latestWs();
      ws1.simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      conn.subscribe("sub-2", [{ kinds: [3] }]);
      expect(countREQs(ws1)).toBe(2);

      // Simulate disconnect
      ws1.simulateClose();

      // Advance timers to trigger reconnect
      vi.advanceTimersByTime(60_000);
      const ws2 = latestWs();
      expect(ws2).not.toBe(ws1);

      ws2.simulateOpen();

      // Both subs should be re-sent exactly once
      const ids = reqSubIds(ws2);
      expect(ids.filter((id) => id === "sub-1")).toHaveLength(1);
      expect(ids.filter((id) => id === "sub-2")).toHaveLength(1);
      expect(countREQs(ws2)).toBe(2);
    });

    it("does not re-send closed subscriptions on reconnect", () => {
      const conn = createConn();
      conn.connect();
      const ws1 = latestWs();
      ws1.simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      conn.subscribe("sub-2", [{ kinds: [3] }]);
      conn.closeSubscription("sub-1");

      ws1.simulateClose();
      vi.advanceTimersByTime(60_000);
      latestWs().simulateOpen();

      const ids = reqSubIds(latestWs());
      expect(ids).not.toContain("sub-1");
      expect(ids).toContain("sub-2");
    });
  });

  describe("closeSubscription", () => {
    it("sends CLOSE message and removes from active subs", () => {
      const conn = createConn();
      conn.connect();
      latestWs().simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      conn.closeSubscription("sub-1");

      expect(conn.hasSubscription("sub-1")).toBe(false);
      const msgs = parseSent(latestWs());
      const closes = msgs.filter((m) => m[0] === "CLOSE");
      expect(closes).toHaveLength(1);
      expect(closes[0]).toEqual(["CLOSE", "sub-1"]);
    });
  });

  describe("EOSE handling", () => {
    it("clears pending EOSE on receiving EOSE message", () => {
      const eoseSpy = vi.fn();
      const conn = createConn();
      conn.setCallbacks({ onEOSE: eoseSpy });
      conn.connect();
      latestWs().simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      latestWs().simulateMessage(["EOSE", "sub-1"]);

      expect(eoseSpy).toHaveBeenCalledWith("sub-1", "wss://test.relay");
    });
  });

  describe("EVENT handling", () => {
    it("routes events to the onEvent callback with subId and relay URL", () => {
      const eventSpy = vi.fn();
      const conn = createConn();
      conn.setCallbacks({ onEvent: eventSpy });
      conn.connect();
      latestWs().simulateOpen();

      const fakeEvent = { id: "abc", pubkey: "pk", kind: 1, content: "hi", tags: [], created_at: 1000, sig: "sig" };
      latestWs().simulateMessage(["EVENT", "sub-1", fakeEvent]);

      expect(eventSpy).toHaveBeenCalledWith("sub-1", fakeEvent, "wss://test.relay");
      expect(conn.getEventCount()).toBe(1);
    });
  });

  describe("CLOSED handling", () => {
    it("removes subscription when relay sends CLOSED", () => {
      const conn = createConn();
      conn.connect();
      latestWs().simulateOpen();

      conn.subscribe("sub-1", [{ kinds: [1] }]);
      expect(conn.hasSubscription("sub-1")).toBe(true);

      latestWs().simulateMessage(["CLOSED", "sub-1", "rate-limited:"]);
      expect(conn.hasSubscription("sub-1")).toBe(false);
    });
  });

  describe("message queue", () => {
    it("queues non-REQ messages while disconnected and flushes on connect", () => {
      const conn = createConn();
      conn.connect();

      const fakeEvent = { id: "e1", pubkey: "pk", kind: 1, content: "", tags: [], created_at: 1, sig: "s" };
      conn.publish(fakeEvent);

      // EVENT should be queued (not a REQ, so it goes through send())
      expect(latestWs().sent).toHaveLength(0);

      latestWs().simulateOpen();

      // After connect, EVENT should be flushed
      const msgs = parseSent(latestWs());
      const events = msgs.filter((m) => m[0] === "EVENT");
      expect(events).toHaveLength(1);
    });
  });

  describe("status transitions", () => {
    it("reports status changes via callback", () => {
      const statusSpy = vi.fn();
      const conn = createConn();
      conn.setCallbacks({ onStatusChange: statusSpy });

      expect(conn.getStatus()).toBe("disconnected");

      conn.connect();
      expect(conn.getStatus()).toBe("connecting");

      latestWs().simulateOpen();
      expect(conn.getStatus()).toBe("connected");
      expect(statusSpy).toHaveBeenCalledWith("wss://test.relay", "connected", undefined);
    });
  });
});
