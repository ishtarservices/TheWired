import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub WebSocket so the relay-reachability pre-flight in connect() resolves "open"
// for the fake relay URLs used here.
class FakeWebSocket {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
}

const mocks = vi.hoisted(() => ({
  fromBunker: vi.fn(),
  parseBunkerInput: vi.fn(),
}));
vi.mock("nostr-tools/nip46", () => ({
  BunkerSigner: { fromBunker: mocks.fromBunker },
  parseBunkerInput: mocks.parseBunkerInput,
}));

import { Nip46Signer } from "../nip46Signer";

const noop = () => {};

describe("Nip46Signer.connect", () => {
  beforeEach(() => {
    mocks.fromBunker.mockReset();
    mocks.parseBunkerInput.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects non-bunker URIs without a network call", async () => {
    await expect(
      Nip46Signer.connect("nostr+walletconnect://x", new Uint8Array(32), {
        onAuthUrl: noop,
      }),
    ).rejects.toThrow(/bunker:\/\//);
    expect(mocks.parseBunkerInput).not.toHaveBeenCalled();
  });

  it("rejects a bunker URI that has no relays", async () => {
    mocks.parseBunkerInput.mockResolvedValue({
      pubkey: "remote",
      relays: [],
      secret: null,
    });
    await expect(
      Nip46Signer.connect("bunker://remote", new Uint8Array(32), {
        onAuthUrl: noop,
      }),
    ).rejects.toThrow(/no relays/);
  });

  it("connects, learns the user pubkey, and maps a signed event", async () => {
    mocks.parseBunkerInput.mockResolvedValue({
      pubkey: "remotesigner",
      relays: ["wss://relay"],
      secret: null,
    });
    const fakeBunker = {
      sendRequest: vi.fn().mockResolvedValue("ack"),
      getPublicKey: vi.fn().mockResolvedValue("userpubkey"),
      signEvent: vi.fn().mockResolvedValue({
        id: "id1",
        pubkey: "userpubkey",
        created_at: 1,
        kind: 1,
        tags: [],
        content: "hi",
        sig: "sig1",
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fromBunker.mockReturnValue(fakeBunker);

    const signer = await Nip46Signer.connect(
      "bunker://remotesigner?relay=wss://relay",
      new Uint8Array(32),
      { onAuthUrl: noop },
    );

    expect(await signer.getPublicKey()).toBe("userpubkey");
    const ev = await signer.signEvent({
      pubkey: "userpubkey",
      created_at: 1,
      kind: 1,
      tags: [],
      content: "hi",
    });
    expect(ev.id).toBe("id1");
    expect(ev.sig).toBe("sig1");
    expect(ev.pubkey).toBe("userpubkey");
  });

  it("rejects when the bunker signs with a mismatched pubkey", async () => {
    mocks.parseBunkerInput.mockResolvedValue({
      pubkey: "remote",
      relays: ["wss://relay"],
      secret: null,
    });
    const fakeBunker = {
      sendRequest: vi.fn().mockResolvedValue("ack"),
      getPublicKey: vi.fn().mockResolvedValue("userpubkey"),
      signEvent: vi.fn().mockResolvedValue({
        id: "id1",
        pubkey: "ATTACKER",
        created_at: 1,
        kind: 1,
        tags: [],
        content: "",
        sig: "s",
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fromBunker.mockReturnValue(fakeBunker);

    const signer = await Nip46Signer.connect(
      "bunker://remote?relay=wss://relay",
      new Uint8Array(32),
      { onAuthUrl: noop },
    );
    await expect(
      signer.signEvent({
        pubkey: "userpubkey",
        created_at: 1,
        kind: 1,
        tags: [],
        content: "",
      }),
    ).rejects.toThrow(/unexpected key/);
  });

  it("aborts when the bunker's known pubkey doesn't match the expected one", async () => {
    mocks.parseBunkerInput.mockResolvedValue({
      pubkey: "remote",
      relays: ["wss://relay"],
      secret: null,
    });
    mocks.fromBunker.mockReturnValue({
      sendRequest: vi.fn().mockResolvedValue("ack"),
      getPublicKey: vi.fn().mockResolvedValue("actualpubkey"),
      close: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      Nip46Signer.connect("bunker://remote?relay=wss://relay", new Uint8Array(32), {
        onAuthUrl: noop,
        knownUserPubkey: "expectedpubkey",
      }),
    ).rejects.toThrow(/different account/);
  });

  it("fails fast with a named-relay error when the bunker relay is unreachable", async () => {
    class DeadWebSocket {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", DeadWebSocket);
    mocks.parseBunkerInput.mockResolvedValue({
      pubkey: "remote",
      relays: ["wss://offchain.pub"],
      secret: null,
    });
    await expect(
      Nip46Signer.connect(
        "bunker://remote?relay=wss://offchain.pub",
        new Uint8Array(32),
        { onAuthUrl: noop },
      ),
    ).rejects.toThrow(/Couldn't reach.*offchain\.pub/);
    // Should short-circuit before constructing the bunker.
    expect(mocks.fromBunker).not.toHaveBeenCalled();
  });
});
