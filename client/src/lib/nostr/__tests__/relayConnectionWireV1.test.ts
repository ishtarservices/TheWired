import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RelayConnection } from "../relayConnection";
import { StormDetector } from "../reconnect";
import { Negentropy, NegentropyStorageVector } from "@ishtarservices/core";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/** Mock WebSocket; the test drives open/messages by hand. */
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  frames(): unknown[][] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const id = (n: number) => bytesToHex(sha256(utf8ToBytes(`ev-${n}`)));

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connect(withAuth = true) {
  const conn = new RelayConnection("wss://relay.test", "read", new StormDetector());
  const onAuth = vi.fn(async (challenge: string) => ({
    id: "auth-" + challenge,
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: 22242,
    tags: [["relay", "wss://relay.test"], ["challenge", challenge]],
    content: "",
    sig: "0".repeat(128),
  }));
  conn.setCallbacks(withAuth ? { onAuth } : {});
  conn.connect();
  const ws = MockWebSocket.instances[0];
  ws.open();
  return { conn, ws, onAuth };
}

describe("CLOSED auth-required → AUTH → re-REQ (docs/DM_WIRE_CONTRACT.md §7.1)", () => {
  it("re-sends the closed subscription after the AUTH OK", async () => {
    const { conn, ws } = connect();
    conn.subscribe("dm", [{ kinds: [1059], "#p": ["a".repeat(64)] }]);
    expect(ws.frames().filter((f) => f[0] === "REQ")).toHaveLength(1);

    // Relay: challenge, then refuse the pre-AUTH REQ.
    ws.receive(["AUTH", "chal-1"]);
    await vi.advanceTimersByTimeAsync(0);
    ws.receive(["CLOSED", "dm", "auth-required: gift wraps are served only to their recipient"]);
    // The AUTH answer went out; the REQ has NOT been re-sent yet.
    expect(ws.frames().filter((f) => f[0] === "AUTH")).toHaveLength(1);
    expect(ws.frames().filter((f) => f[0] === "REQ")).toHaveLength(1);

    ws.receive(["OK", "auth-chal-1", true, ""]);
    const reqs = ws.frames().filter((f) => f[0] === "REQ");
    expect(reqs).toHaveLength(2);
    expect(reqs[1][1]).toBe("dm");
  });

  it("gives up holding after the wedge timeout so a broken AUTH can't starve the sub", async () => {
    const { conn, ws } = connect();
    conn.subscribe("dm", [{ kinds: [1059] }]);
    ws.receive(["AUTH", "chal-2"]);
    await vi.advanceTimersByTimeAsync(0);
    ws.receive(["CLOSED", "dm", "auth-required: nope"]);
    await vi.advanceTimersByTimeAsync(3500);
    expect(ws.frames().filter((f) => f[0] === "REQ")).toHaveLength(2);
  });
});

describe("NIP-77 negentropySync (§7.5)", () => {
  it("reconciles against a responder and reports need/have; NEG-CLOSE follows", async () => {
    const { conn, ws } = connect(false);
    // The relay holds ids 1..30; the client holds 1..20 plus one it never published.
    const relayStorage = new NegentropyStorageVector();
    for (let i = 1; i <= 30; i++) relayStorage.insert(1000 + i, id(i));
    relayStorage.seal();
    const responder = new Negentropy(relayStorage, 60_000);

    const items = [];
    for (let i = 1; i <= 20; i++) items.push({ id: id(i), created_at: 1000 + i });
    items.push({ id: id(999), created_at: 5000 });

    const promise = conn.negentropySync({ kinds: [1059], "#p": ["a".repeat(64)] }, items);
    // Drive the exchange: every NEG-OPEN / NEG-MSG the client sends is answered.
    for (let round = 0; round < 10; round++) {
      const pending = ws.frames().filter((f) => f[0] === "NEG-OPEN" || f[0] === "NEG-MSG");
      const last = pending[pending.length - 1];
      if (!last) break;
      const subId = last[1] as string;
      const msg = (last[0] === "NEG-OPEN" ? last[3] : last[2]) as string;
      const reply = responder.reconcile(msg);
      if (reply === null) break;
      ws.receive(["NEG-MSG", subId, reply]);
      // stop when the client closed the session
      if (ws.frames().some((f) => f[0] === "NEG-CLOSE")) break;
    }
    const result = await promise;
    expect(result).not.toBeNull();
    const expectedNeed = [];
    for (let i = 21; i <= 30; i++) expectedNeed.push(id(i));
    expect(new Set(result!.need)).toEqual(new Set(expectedNeed));
    expect(result!.have).toEqual([id(999)]);
    expect(ws.frames().some((f) => f[0] === "NEG-CLOSE")).toBe(true);
  });

  it("resolves null when the relay does not speak NEG-* and short-circuits afterwards", async () => {
    const { conn, ws } = connect(false);
    const p = conn.negentropySync({ kinds: [1059] }, []);
    ws.receive(["NOTICE", "unknown message type: NEG-OPEN"]);
    expect(await p).toBeNull();
    expect(await conn.negentropySync({ kinds: [1059] }, [])).toBeNull();
    expect(ws.frames().filter((f) => f[0] === "NEG-OPEN")).toHaveLength(1);
  });

  it("resolves null on NEG-ERR and on timeout", async () => {
    const { conn, ws } = connect(false);
    const p1 = conn.negentropySync({ kinds: [1059] }, []);
    const open1 = ws.frames().find((f) => f[0] === "NEG-OPEN")!;
    ws.receive(["NEG-ERR", open1[1], "blocked: too many records"]);
    expect(await p1).toBeNull();

    const p2 = conn.negentropySync({ kinds: [1059] }, [], 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await p2).toBeNull();
  });
});
