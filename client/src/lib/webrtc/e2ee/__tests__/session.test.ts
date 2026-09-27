/**
 * E2EESession wiring: call sessions derive keys and never send envelopes;
 * channel sessions run the key manager over the gift-wrap sender and the
 * inbox. livekit-client, the worker and the sender are all injected/mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";

const h = vi.hoisted(() => {
  const set: Array<{ identity: string; keyIndex: number }> = [];
  class BaseKeyProvider {
    constructor(_o: unknown) {}
    protected onSetEncryptionKey(_key: unknown, identity?: string, keyIndex?: number) {
      set.push({ identity: identity!, keyIndex: keyIndex! });
    }
  }
  return { set, BaseKeyProvider, supported: true };
});
vi.mock("livekit-client", () => ({
  BaseKeyProvider: h.BaseKeyProvider,
  createKeyMaterialFromBuffer: async () => ({}),
  isE2EESupported: () => h.supported,
}));
// The real sender pulls in the gift-wrap + relay stack; sessions under test
// get `send` injected.
vi.mock("../mediaKeySender", () => ({ sendMediaKey: vi.fn() }));
vi.mock("../e2eeWorker", () => ({
  createE2EEWorker: () => {
    throw new Error("real worker must not be created in tests");
  },
}));

// jsdom's ArrayBuffer is a different realm from Node's webcrypto, so the real
// crypto.subtle.importKey rejects it here; production runs in one realm.
const realCrypto = globalThis.crypto;
vi.stubGlobal("crypto", {
  getRandomValues: (a: Uint8Array) => realCrypto.getRandomValues(a),
  randomUUID: () => realCrypto.randomUUID(),
  subtle: { importKey: async (_f: string, _b: ArrayBuffer, algo: unknown) => ({ algo }) },
});
import { createE2EESession, E2EEUnsupportedError, e2eeSupported } from "../session";
import { deliverMediaKey, resetMediaKeyInbox } from "../mediaKeyInbox";
import { USE_KEY_DELAY_MS, ROTATE_DEBOUNCE_MS } from "../channelKeys";

const ME = "f".repeat(64);
const PEER = "a".repeat(64);
const B = "b".repeat(64);
const ROOM = "ab".repeat(32);
const SECRET = "01".repeat(32);

function fakeWorker() {
  return { terminate: vi.fn() } as unknown as Worker & { terminate: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  h.set.length = 0;
  h.supported = true;
  resetMediaKeyInbox();
});

describe("support gate", () => {
  it("throws E2EEUnsupportedError (and builds nothing) when the WebView can't", () => {
    h.supported = false;
    expect(e2eeSupported()).toBe(false);
    expect(() => createE2EESession({ kind: "channel", roomName: "r" }, ME, { worker: fakeWorker() })).toThrow(
      E2EEUnsupportedError,
    );
  });
});

describe("call session", () => {
  const ctx = { kind: "call" as const, roomId: ROOM, roomSecretKeyHex: SECRET, peerPubkey: PEER };

  it("installs both derived keys before connect and sends no envelopes", async () => {
    const send = vi.fn();
    const worker = fakeWorker();
    const s = createE2EESession(ctx, ME, { worker, send });
    await s.installInitialKeys();
    expect(h.set).toEqual(expect.arrayContaining([{ identity: ME, keyIndex: 0 }, { identity: PEER, keyIndex: 0 }]));
    await s.start([PEER]);
    await s.onParticipantJoined(PEER);
    s.onParticipantLeft(PEER);
    expect(send).not.toHaveBeenCalled();
  });

  it("re-asserts the keys on reconnect and terminates the worker once on dispose", async () => {
    const worker = fakeWorker();
    const s = createE2EESession(ctx, ME, { worker });
    await s.installInitialKeys();
    h.set.length = 0;
    await s.onReconnected();
    expect(h.set.map((c) => c.identity).sort()).toEqual([PEER, ME].sort());
    s.dispose();
    s.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    h.set.length = 0;
    await s.onReconnected();
    expect(h.set).toHaveLength(0);
  });
});

describe("channel session", () => {
  const ctx = { kind: "channel" as const, roomName: "space:chan" };

  it("fans our key out on start, installs inbox keys, rotates on leave, and unhooks on dispose", async () => {
    vi.useFakeTimers();
    try {
      const sends: Array<{ to: string; env: DMMediaKeyEnvelope }> = [];
      const send = vi.fn(async (to: string, env: DMMediaKeyEnvelope) => {
        sends.push({ to, env });
      });
      const worker = fakeWorker();
      const s = createE2EESession(ctx, ME, { worker, send });
      await s.installInitialKeys(); // no-op for channels
      expect(h.set).toHaveLength(0);

      // A peer's key that lands while we are still connecting (before start)
      // is installed, not lost.
      const early: DMMediaKeyEnvelope = { v: 1, room: "space:chan", keys: [{ idx: 0, key: "0c".repeat(32) }], ts: Date.now() };
      expect(deliverMediaKey(B, early, "w0")).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.set).toContainEqual({ identity: B, keyIndex: 0 });
      h.set.length = 0;

      await s.start([PEER, B]);
      expect(h.set).toEqual([{ identity: ME, keyIndex: 0 }]);
      expect(sends.map((x) => x.to).sort()).toEqual([PEER, B].sort());

      // An envelope arriving through the pipeline lands in the provider.
      const env: DMMediaKeyEnvelope = { v: 1, room: "space:chan", keys: [{ idx: 2, key: "0a".repeat(32) }], ts: Date.now() };
      expect(deliverMediaKey(PEER, env, "w1")).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.set).toContainEqual({ identity: PEER, keyIndex: 2 });

      // Wrong room: dropped (bound to the session's own room name).
      deliverMediaKey(B, { ...env, room: "other" }, "w2");
      await vi.advanceTimersByTimeAsync(0);
      expect(h.set.find((c) => c.identity === B && c.keyIndex === 2)).toBeUndefined();

      // Leave → rotation to the remaining member, then the encoder switch.
      sends.length = 0;
      s.onParticipantLeft(PEER);
      await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
      expect(sends.map((x) => x.to)).toEqual([B]);
      expect(h.set[h.set.length - 1]).toEqual({ identity: ME, keyIndex: 1 });

      s.dispose();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      // After dispose the inbox no longer reaches this session.
      expect(deliverMediaKey(B, { ...env, ts: Date.now() }, "w3")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
