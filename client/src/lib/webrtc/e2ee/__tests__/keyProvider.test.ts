/**
 * NostrKeyProvider + installCallKeys against a mocked livekit-client:
 * per-participant mode, key material import, index bookkeeping.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import { deriveCallSenderKey } from "@ishtarservices/core";

const h = vi.hoisted(() => {
  const set: Array<{ key: unknown; identity?: string; keyIndex?: number }> = [];
  class BaseKeyProvider {
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    protected onSetEncryptionKey(key: unknown, identity?: string, keyIndex?: number) {
      set.push({ key, identity, keyIndex });
    }
  }
  return { set, BaseKeyProvider };
});

vi.mock("livekit-client", () => ({
  BaseKeyProvider: h.BaseKeyProvider,
  createKeyMaterialFromBuffer: async (buf: ArrayBuffer) => ({ material: bytesToHex(new Uint8Array(buf)) }),
}));

import { NostrKeyProvider, NOSTR_KEY_PROVIDER_OPTIONS } from "../NostrKeyProvider";
import { installCallKeys } from "../callKeys";

const ME = "f".repeat(64);
const PEER = "a".repeat(64);
const ROOM = "ab".repeat(32);
const SECRET = "01".repeat(32);

beforeEach(() => {
  h.set.length = 0;
});

describe("NostrKeyProvider", () => {
  it("runs in per-participant mode with the full keyring and no auto-ratchet", () => {
    const p = new NostrKeyProvider();
    expect((p as unknown as { options: Record<string, unknown> }).options).toEqual(NOSTR_KEY_PROVIDER_OPTIONS);
    expect(NOSTR_KEY_PROVIDER_OPTIONS).toEqual({
      sharedKey: false,
      keyringSize: 256,
      ratchetWindowSize: 0,
      failureTolerance: -1,
    });
  });

  it("imports the 32 bytes as HKDF material under the identity and index", async () => {
    const p = new NostrKeyProvider();
    const key = new Uint8Array(32).fill(7);
    await p.setSenderKey(PEER, key, 5);
    expect(h.set).toEqual([{ key: { material: "07".repeat(32) }, identity: PEER, keyIndex: 5 }]);
    expect(p.latestIndex(PEER)).toBe(5);
    expect(p.latestIndex(ME)).toBe(-1);
  });

  it("copies a subarray view so the imported material is exactly the key", async () => {
    const p = new NostrKeyProvider();
    const big = new Uint8Array(64).fill(1);
    big.set(new Uint8Array(32).fill(9), 16);
    await p.setSenderKey(PEER, big.subarray(16, 48), 0);
    expect(h.set[0].key).toEqual({ material: "09".repeat(32) });
  });

  it("rejects wrong key sizes and indices", async () => {
    const p = new NostrKeyProvider();
    await expect(p.setSenderKey(PEER, new Uint8Array(16), 0)).rejects.toThrow(/32 bytes/);
    await expect(p.setSenderKey(PEER, new Uint8Array(32), 256)).rejects.toThrow(/0–255/);
    await expect(p.setSenderKey(PEER, new Uint8Array(32), -1)).rejects.toThrow(/0–255/);
    expect(h.set).toHaveLength(0);
  });
});

describe("installCallKeys", () => {
  it("installs both derived sender keys at index 0 under each identity", async () => {
    const p = new NostrKeyProvider();
    await installCallKeys(p, { roomId: ROOM, roomSecretKeyHex: SECRET, myPubkey: ME, peerPubkey: PEER });
    const mine = bytesToHex(deriveCallSenderKey(SECRET, ROOM, ME));
    const theirs = bytesToHex(deriveCallSenderKey(SECRET, ROOM, PEER));
    expect(mine).not.toBe(theirs);
    expect(h.set).toEqual(
      expect.arrayContaining([
        { key: { material: mine }, identity: ME, keyIndex: 0 },
        { key: { material: theirs }, identity: PEER, keyIndex: 0 },
      ]),
    );
    expect(h.set).toHaveLength(2);
  });

  it("refuses a malformed secret before touching the provider", async () => {
    const p = new NostrKeyProvider();
    await expect(
      installCallKeys(p, { roomId: ROOM, roomSecretKeyHex: "nope", myPubkey: ME, peerPubkey: PEER }),
    ).rejects.toThrow();
    expect(h.set).toHaveLength(0);
  });
});
