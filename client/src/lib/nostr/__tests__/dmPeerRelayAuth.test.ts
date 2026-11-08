import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NostrEvent } from "../../../types/nostr";

// AUTH privacy for gift-wrap delivery (docs/DM_WIRE_CONTRACT.md §1): the wrap
// is signed by an ephemeral key, so a kind-22242 signed by the identity key is
// the one frame on a socket to a recipient-chosen relay that names the sender.
// Drive the REAL relayManager + dmRelayList over mocked sockets and check what
// reaches the wire of a relay only the peer's kind-10050 list named.

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
const PEER_INBOX = "wss://peer-inbox.example";

const signEvent = vi.fn(async (u: Omit<NostrEvent, "id" | "sig">) => ({
  ...u,
  id: "e".repeat(64),
  sig: "f".repeat(128),
}));
vi.mock("../loginFlow", () => ({
  getSigner: () => ({ signEvent }),
  getSignerTimeoutMs: () => 10_000,
}));
let ownDmRelays: string[] = [];
vi.mock("../../../store", () => ({
  store: { getState: () => ({ identity: { pubkey: ME, dmRelayList: ownDmRelays } }) },
}));

import { relayManager } from "../relayManager";
import { getDMRelaysForPublish, clearDMRelayCache } from "../dmRelayList";
import { APP_RELAY } from "../constants";

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
  receive(frame: unknown[]) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  frames(): unknown[][] { return this.sent.map((s) => JSON.parse(s)); }
}

let sockets: MockWebSocket[] = [];
const socketFor = (url: string) => sockets.find((s) => s.url.replace(/\/$/, "") === url.replace(/\/$/, ""));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }
/** Wait until a socket for `url` was created, then open it. */
async function openWhenDialed(url: string): Promise<MockWebSocket> {
  for (let i = 0; i < 50; i++) {
    const ws = socketFor(url);
    if (ws) { ws.simulateOpen(); return ws; }
    await tick();
  }
  throw new Error(`never dialed ${url}`);
}
const authFrames = (ws: MockWebSocket) => ws.frames().filter((f) => f[0] === "AUTH");

/** Answer the peer's kind-10050 lookup from the first bootstrap socket that asks. */
async function serveDmRelayList(relays: string[]): Promise<void> {
  const app = await openWhenDialed(APP_RELAY);
  for (let i = 0; i < 50 && !app.frames().some((f) => f[0] === "REQ"); i++) await tick();
  const req = app.frames().find((f) => f[0] === "REQ")!;
  const subId = req[1] as string;
  const list: NostrEvent = {
    id: "1".repeat(64), pubkey: PEER, created_at: 1, kind: 10050,
    tags: relays.map((r) => ["relay", r]), content: "", sig: "0".repeat(128),
  };
  app.receive(["EVENT", subId, list]);
  app.receive(["EOSE", subId]);
}

beforeEach(() => {
  sockets = [];
  ownDmRelays = [];
  signEvent.mockClear();
  vi.stubGlobal("WebSocket", class extends MockWebSocket {
    constructor(url: string) { super(url); sockets.push(this); }
  });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no nip11")));
  relayManager.disconnectAll();
  clearDMRelayCache();
});

afterEach(() => {
  relayManager.disconnectAll();
  clearDMRelayCache();
  vi.restoreAllMocks();
});

describe("gift-wrap delivery never authenticates as the user on a recipient-chosen relay", () => {
  it("a relay named only by the peer's kind 10050 gets no kind 22242 for its AUTH challenge", async () => {
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    const peer = await openWhenDialed(PEER_INBOX);
    const targets = await pending;
    expect(targets).toContain(PEER_INBOX);

    peer.receive(["AUTH", "peer-challenge"]);
    await settle();

    expect(authFrames(peer)).toHaveLength(0);
    expect(signEvent).not.toHaveBeenCalled();
  });

  it("the platform relay still authenticates (self-wrap detection, §7.3)", async () => {
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    await openWhenDialed(PEER_INBOX);
    await pending;

    const app = socketFor(APP_RELAY)!;
    app.receive(["AUTH", "app-challenge"]);
    await settle();

    expect(authFrames(app)).toHaveLength(1);
    const [, auth] = authFrames(app)[0] as [string, NostrEvent];
    expect(auth.kind).toBe(22242);
    expect(auth.pubkey).toBe(ME);
  });

  it("a peer relay the user also chose (own kind 10050) is answered", async () => {
    ownDmRelays = [PEER_INBOX];
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    const peer = await openWhenDialed(PEER_INBOX);
    await pending;

    peer.receive(["AUTH", "peer-challenge"]);
    await settle();

    expect(authFrames(peer)).toHaveLength(1);
  });

  it("a peer-only relay carries no broadcast REQ and no untargeted publish", async () => {
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    const peer = await openWhenDialed(PEER_INBOX);
    await pending;

    // What the login flow does for the account's own lists: no relayUrls.
    relayManager.subscribe({
      filters: [{ kinds: [0], authors: [ME], limit: 1 }],
      onEvent: () => {},
    });
    const note: NostrEvent = {
      id: "2".repeat(64), pubkey: ME, created_at: 1, kind: 1, tags: [], content: "hi", sig: "0".repeat(128),
    };
    relayManager.publish(note);
    await settle();

    expect(peer.frames().filter((f) => f[0] === "REQ")).toHaveLength(0);
    expect(peer.frames().filter((f) => f[0] === "EVENT")).toHaveLength(0);
    expect(relayManager.getWriteRelays().map((c) => c.url)).not.toContain(PEER_INBOX);
    expect(relayManager.getReadRelays().map((c) => c.url)).not.toContain(PEER_INBOX);
  });

  it("a plain connect() for the same relay later lifts the restriction and answers the pending challenge", async () => {
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    const peer = await openWhenDialed(PEER_INBOX);
    await pending;
    peer.receive(["AUTH", "peer-challenge"]);
    await settle();
    expect(authFrames(peer)).toHaveLength(0);
    expect(relayManager.isPeerOnly(PEER_INBOX)).toBe(true);

    // The user adds it to their NIP-65 list / joins a space hosted there.
    relayManager.connect(PEER_INBOX, "read+write");
    await settle();

    expect(relayManager.isPeerOnly(PEER_INBOX)).toBe(false);
    expect(authFrames(peer)).toHaveLength(1);
    expect(relayManager.getWriteRelays().map((c) => c.url)).toContain(PEER_INBOX);
  });

  it("the wrap itself still reaches the peer relay when targeted", async () => {
    const pending = getDMRelaysForPublish(PEER);
    await serveDmRelayList([PEER_INBOX]);
    const peer = await openWhenDialed(PEER_INBOX);
    const targets = (await pending)!;
    const wrap: NostrEvent = {
      id: "3".repeat(64), pubkey: "c".repeat(64), created_at: 1, kind: 1059,
      tags: [["p", PEER]], content: "…", sig: "0".repeat(128),
    };
    expect(relayManager.publish(wrap, targets)).toBe(targets.length);
    expect(peer.frames().filter((f) => f[0] === "EVENT")).toHaveLength(1);
  });
});
