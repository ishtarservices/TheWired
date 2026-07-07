import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { createChatSession, matchesChannel } from "../chatSession";
import { verifyEventSync } from "../verifyEvent";

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
}

const SPACE = "space-1";
const CHANNEL = "chan-1";
const secret = generateSecretKey();
const pubkey = getPublicKey(secret);

function chatEvent(content: string, tags: string[][]): NostrEvent {
  return finalizeEvent(
    { kind: 9, created_at: 1_700_000_000, tags, content },
    generateSecretKey(),
  );
}

function makeHarness(opts: { signer?: boolean; isDefault?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const received: NostrEvent[] = [];
  const adapters = {
    ws: {
      create(url: string) {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    },
    verifier: { verify: async (event: NostrEvent) => verifyEventSync(event) },
    signer: opts.signer ? new LocalNsecSigner(secret) : null,
  } as unknown as PlatformAdapters;

  const session = createChatSession({
    adapters,
    relayUrl: "wss://host.example",
    spaceId: SPACE,
    channelId: CHANNEL,
    isDefaultChannel: opts.isDefault ?? true,
    onMessage: (event) => received.push(event),
  });
  return { session, sockets, received };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("matchesChannel", () => {
  const base = (tags: string[][]) => chatEvent("x", tags);

  it("routes h-tagged messages by channel tag, untagged to the default", () => {
    expect(matchesChannel(base([["h", SPACE], ["channel", CHANNEL]]), SPACE, CHANNEL, false)).toBe(true);
    expect(matchesChannel(base([["h", SPACE], ["channel", "other"]]), SPACE, CHANNEL, false)).toBe(false);
    expect(matchesChannel(base([["h", SPACE]]), SPACE, CHANNEL, true)).toBe(true);
    expect(matchesChannel(base([["h", SPACE]]), SPACE, CHANNEL, false)).toBe(false);
    expect(matchesChannel(base([["h", "other-space"]]), SPACE, CHANNEL, true)).toBe(false);
    expect(matchesChannel({ ...base([["h", SPACE]]), kind: 1 }, SPACE, CHANNEL, true)).toBe(false);
  });
});

describe("chat session", () => {
  it("dials the host relay, REQs kind-9 by #h, and routes verified messages", async () => {
    const { session, sockets, received } = makeHarness();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://host.example");
    sockets[0].open();

    const req = sockets[0].frames().find((f) => f[0] === "REQ")!;
    expect(req[2]).toMatchObject({ kinds: [9], "#h": [SPACE] });

    const good = chatEvent("hello space", [["h", SPACE]]);
    const forged = { ...chatEvent("bad", [["h", SPACE]]), content: "tampered" };
    const otherSpace = chatEvent("elsewhere", [["h", "other"]]);
    sockets[0].message(["EVENT", req[1], good]);
    sockets[0].message(["EVENT", req[1], forged]);
    sockets[0].message(["EVENT", req[1], otherSpace]);
    await flush();

    expect(received.map((e) => e.content)).toEqual(["hello space"]);
    session.destroy();
    expect(sockets[0].readyState).toBe(3); // socket closed on leave
  });

  it("posts an h-tagged kind-9 and resolves on OK (echoing optimistically)", async () => {
    const { session, sockets, received } = makeHarness({ signer: true });
    sockets[0].open();

    const posted = session.post("gm everyone");
    await flush();
    const frame = sockets[0].frames().find((f) => f[0] === "EVENT")!;
    const event = frame[1] as NostrEvent;
    expect(event.kind).toBe(9);
    expect(event.pubkey).toBe(pubkey);
    expect(event.tags).toContainEqual(["h", SPACE]);

    sockets[0].message(["OK", event.id, true, ""]);
    await expect(posted).resolves.toBe(true);
    await flush();
    expect(received.map((e) => e.id)).toContain(event.id);
    session.destroy();
  });

  it("tags non-default channels and surfaces relay membership rejections", async () => {
    const { session, sockets } = makeHarness({ signer: true, isDefault: false });
    sockets[0].open();

    const posted = session.post("let me in");
    await flush();
    const frame = sockets[0].frames().find((f) => f[0] === "EVENT")!;
    const event = frame[1] as NostrEvent;
    expect(event.tags).toContainEqual(["channel", CHANNEL]);

    // NIP-29 membership enforcement: the relay refuses non-members.
    sockets[0].message(["OK", event.id, false, "restricted: not a member"]);
    await expect(posted).rejects.toThrow(/not a member/);
    session.destroy();
  });

  it("rejects guest posting (no signer)", async () => {
    const { session, sockets } = makeHarness();
    sockets[0].open();
    await expect(session.post("hi")).rejects.toThrow(/sign in/i);
    session.destroy();
  });

  it("answers a NIP-42 AUTH challenge with a signed 22242 and re-REQs", async () => {
    const { session, sockets } = makeHarness({ signer: true });
    sockets[0].open();
    const reqsBefore = sockets[0].frames().filter((f) => f[0] === "REQ").length;

    sockets[0].message(["AUTH", "challenge-abc"]);
    await flush();
    const authFrame = sockets[0].frames().find((f) => f[0] === "AUTH")!;
    expect(authFrame).toBeDefined();
    const authEvent = authFrame[1] as NostrEvent;
    expect(authEvent.kind).toBe(22242);
    expect(authEvent.pubkey).toBe(pubkey);
    expect(authEvent.tags).toContainEqual(["challenge", "challenge-abc"]);
    expect(authEvent.tags).toContainEqual(["relay", "wss://host.example"]);
    expect(verifyEventSync(authEvent)).toBe(true);

    // The chat REQ is re-sent after auth so the relay re-evaluates it.
    await new Promise((r) => setTimeout(r, 500));
    expect(sockets[0].frames().filter((f) => f[0] === "REQ").length).toBeGreaterThan(reqsBefore);
    session.destroy();
  });

  it("guests ignore AUTH challenges (no signer to answer with)", async () => {
    const { session, sockets } = makeHarness();
    sockets[0].open();
    sockets[0].message(["AUTH", "challenge-abc"]);
    await flush();
    expect(sockets[0].frames().some((f) => f[0] === "AUTH")).toBe(false);
    session.destroy();
  });
});
