/**
 * Channel key rotation state machine (docs/E2EE_CALLS.md §4).
 *
 * Pure deps: no LiveKit, no gift wraps. Fake timers drive the debounce,
 * the use-key delay and the periodic rotation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";
import {
  ChannelKeyManager,
  USE_KEY_DELAY_MS,
  ROTATE_DEBOUNCE_MS,
  PERIODIC_ROTATE_MS,
} from "../channelKeys";

const ME = "f".repeat(64);
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ROOM = "space:chan";

type SetKeyCall = { identity: string; key: string; idx: number };
type SendCall = { to: string; env: DMMediaKeyEnvelope };

function harness(opts: { now?: () => number } = {}) {
  const setKeys: SetKeyCall[] = [];
  const sends: SendCall[] = [];
  let counter = 0;
  const random32 = () => {
    const out = new Uint8Array(32);
    out.fill(++counter);
    return out;
  };
  let clock = 1_000_000;
  const now = opts.now ?? (() => clock);
  const warn = vi.fn();
  const mgr = new ChannelKeyManager({
    roomName: ROOM,
    myPubkey: ME,
    sink: {
      async setSenderKey(identity, keyBytes, keyIndex) {
        setKeys.push({ identity, key: bytesToHex(keyBytes), idx: keyIndex });
      },
    },
    send: async (to, env) => {
      sends.push({ to, env });
    },
    random32,
    now,
    warn,
  });
  return {
    mgr,
    setKeys,
    sends,
    warn,
    tick(ms: number) {
      clock += ms;
    },
    myKeyAt: (idx: number) => setKeys.find((c) => c.identity === ME && c.idx === idx)?.key,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("start", () => {
  it("installs key 0 locally and hands it to everyone already present", async () => {
    const h = harness();
    await h.mgr.start([A, B]);
    expect(h.mgr.currentIndex).toBe(0);
    expect(h.setKeys).toEqual([{ identity: ME, key: h.myKeyAt(0), idx: 0 }]);
    expect(h.sends.map((s) => s.to).sort()).toEqual([A, B]);
    for (const s of h.sends) {
      expect(s.env).toEqual({ v: 1, room: ROOM, keys: [{ idx: 0, key: h.myKeyAt(0) }], ts: 1_000_000 });
    }
  });

  it("ignores non-pubkey identities and ourselves", async () => {
    const h = harness();
    await h.mgr.start(["agent-bot", ME, A]);
    expect(h.sends.map((s) => s.to)).toEqual([A]);
    expect(h.mgr.memberCount).toBe(1);
  });
});

describe("join", () => {
  it("sends the current key to the joiner only", async () => {
    const h = harness();
    await h.mgr.start([A]);
    h.sends.length = 0;
    await h.mgr.onParticipantJoined(B);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0].to).toBe(B);
    expect(h.sends[0].env.keys).toEqual([{ idx: 0, key: h.myKeyAt(0) }]);
    expect(h.mgr.currentIndex).toBe(0); // no rotation on join
  });
});

describe("leave → rotate", () => {
  it("distributes the next key to the remaining members BEFORE switching the encoder", async () => {
    const h = harness();
    await h.mgr.start([A, B]);
    h.sends.length = 0;
    h.mgr.onParticipantLeft(A);
    expect(h.sends).toHaveLength(0); // debounced
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS);
    // Envelope with idx 1 went to B only (A left).
    expect(h.sends.map((s) => s.to)).toEqual([B]);
    expect(h.sends[0].env.keys).toEqual([{ idx: 1, key: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(h.mgr.nextIndex).toBe(1);
    // Encoder still on 0 until the use-key delay elapses.
    expect(h.mgr.currentIndex).toBe(0);
    expect(h.setKeys.filter((c) => c.identity === ME)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(USE_KEY_DELAY_MS);
    expect(h.mgr.currentIndex).toBe(1);
    expect(h.mgr.nextIndex).toBe(-1);
    expect(h.setKeys[h.setKeys.length - 1]).toEqual({ identity: ME, key: h.sends[0].env.keys[0].key, idx: 1 });
  });

  it("collapses a burst of leaves into one rotation", async () => {
    const h = harness();
    await h.mgr.start([A, B, C]);
    h.sends.length = 0;
    h.mgr.onParticipantLeft(A);
    await vi.advanceTimersByTimeAsync(100);
    h.mgr.onParticipantLeft(B);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(h.sends.map((s) => s.to)).toEqual([C]);
    expect(h.mgr.currentIndex).toBe(1);
  });

  it("a joiner during a rotation gets both the current and the next key", async () => {
    const h = harness();
    await h.mgr.start([A, B]);
    h.mgr.onParticipantLeft(A);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS);
    h.sends.length = 0;
    await h.mgr.onParticipantJoined(C);
    expect(h.sends[0].to).toBe(C);
    expect(h.sends[0].env.keys.map((k) => k.idx)).toEqual([0, 1]);
  });

  it("a leave during a rotation queues another rotation after the switch", async () => {
    const h = harness();
    await h.mgr.start([A, B, C]);
    h.mgr.onParticipantLeft(A);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS);
    expect(h.mgr.nextIndex).toBe(1);
    h.mgr.onParticipantLeft(B); // B already holds key 1
    await vi.advanceTimersByTimeAsync(USE_KEY_DELAY_MS);
    expect(h.mgr.currentIndex).toBe(1);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(h.mgr.currentIndex).toBe(2);
    // Only C ever received key 2.
    const k2 = h.sends.filter((s) => s.env.keys.some((k) => k.idx === 2));
    expect(k2.map((s) => s.to)).toEqual([C]);
  });

  it("does not rotate when nobody is left", async () => {
    const h = harness();
    await h.mgr.start([A]);
    h.mgr.onParticipantLeft(A);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(h.mgr.currentIndex).toBe(0);
  });

  it("wraps the index at 256", async () => {
    const h = harness();
    await h.mgr.start([A]);
    for (let i = 0; i < 256; i++) {
      // Every rotation needs a member present; re-add A each time.
      await h.mgr.onParticipantJoined(A);
      h.mgr.onParticipantLeft(A);
      await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    }
    expect(h.mgr.currentIndex).toBe(0);
  });

  it("rotates periodically during a long session", async () => {
    const h = harness();
    await h.mgr.start([A]);
    await vi.advanceTimersByTimeAsync(PERIODIC_ROTATE_MS + ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(h.mgr.currentIndex).toBe(1);
  });
});

describe("remote keys", () => {
  const env = (over: Partial<DMMediaKeyEnvelope> = {}): DMMediaKeyEnvelope => ({
    v: 1,
    room: ROOM,
    keys: [{ idx: 3, key: "0a".repeat(32) }],
    ts: 1_000_000,
    ...over,
  });

  it("installs every key under the sender identity", async () => {
    const h = harness();
    await h.mgr.start([A]);
    expect(h.mgr.onRemoteKey(A, env({ keys: [{ idx: 3, key: "0a".repeat(32) }, { idx: 4, key: "0b".repeat(32) }] }))).toBe("installed");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.setKeys.filter((c) => c.identity === A)).toEqual([
      { identity: A, key: "0a".repeat(32), idx: 3 },
      { identity: A, key: "0b".repeat(32), idx: 4 },
    ]);
  });

  it("accepts keys from a participant we have not seen join yet (envelope raced the roster)", async () => {
    const h = harness();
    await h.mgr.start([]);
    expect(h.mgr.onRemoteKey(C, env())).toBe("installed");
  });

  it("binds envelopes to this room", async () => {
    const h = harness();
    await h.mgr.start([A]);
    expect(h.mgr.onRemoteKey(A, env({ room: "other:room" }))).toBe("wrong_room");
    expect(h.setKeys.filter((c) => c.identity === A)).toHaveLength(0);
  });

  it("drops envelopes outside the clock-skew window", async () => {
    const h = harness();
    await h.mgr.start([A]);
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_000 - 121_000 }))).toBe("skew");
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_000 + 121_000 }))).toBe("skew");
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_000 + 60_000 }))).toBe("installed");
  });

  it("drops an older envelope after a newer one (per sender), keeps equal timestamps", async () => {
    const h = harness();
    await h.mgr.start([A, B]);
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_500 }))).toBe("installed");
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_400 }))).toBe("stale");
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_500 }))).toBe("installed");
    // Independent per sender.
    expect(h.mgr.onRemoteKey(B, env({ ts: 1_000_400 }))).toBe("installed");
  });

  it("rejects our own pubkey and non-pubkey senders", async () => {
    const h = harness();
    await h.mgr.start([A]);
    expect(h.mgr.onRemoteKey(ME, env())).toBe("bad_sender");
    expect(h.mgr.onRemoteKey("bot", env())).toBe("bad_sender");
  });

  it("forgets the per-sender timestamp when they leave, so a rejoin with a reset clock works", async () => {
    const h = harness();
    await h.mgr.start([A]);
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_900 }))).toBe("installed");
    h.mgr.onParticipantLeft(A);
    await h.mgr.onParticipantJoined(A);
    expect(h.mgr.onRemoteKey(A, env({ ts: 1_000_100 }))).toBe("installed");
  });
});

describe("reconnect and dispose", () => {
  it("re-asserts the local key at the current index and re-shares it", async () => {
    const h = harness();
    await h.mgr.start([A]);
    h.mgr.onParticipantLeft(A);
    await h.mgr.onParticipantJoined(B);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    h.setKeys.length = 0;
    h.sends.length = 0;
    await h.mgr.onReconnected();
    expect(h.setKeys).toEqual([{ identity: ME, key: h.sends[0].env.keys[0].key, idx: 1 }]);
    expect(h.sends.map((s) => s.to)).toEqual([B]);
  });

  it("dispose stops timers and rejects further input", async () => {
    const h = harness();
    await h.mgr.start([A, B]);
    h.mgr.onParticipantLeft(A);
    h.mgr.dispose();
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS + PERIODIC_ROTATE_MS);
    expect(h.sends.filter((s) => s.env.keys.some((k) => k.idx > 0))).toHaveLength(0);
    expect(h.mgr.onRemoteKey(A, { v: 1, room: ROOM, keys: [{ idx: 0, key: "0a".repeat(32) }], ts: 1_000_000 })).toBe("disposed");
    expect(h.mgr.currentIndex).toBe(-1);
  });

  it("keeps the installed key if the encoder switch fails, and warns instead of rejecting", async () => {
    let failNext = false;
    const setKeys: SetKeyCall[] = [];
    const warn = vi.fn();
    const mgr = new ChannelKeyManager({
      roomName: ROOM,
      myPubkey: ME,
      sink: {
        async setSenderKey(identity, keyBytes, keyIndex) {
          if (failNext && keyIndex === 1) throw new Error("worker gone");
          setKeys.push({ identity, key: bytesToHex(keyBytes), idx: keyIndex });
        },
      },
      send: async () => {},
      warn,
    });
    await mgr.start([A, B]);
    failNext = true;
    mgr.onParticipantLeft(A);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(mgr.currentIndex).toBe(0); // still the key the encoder really has
    expect(mgr.nextIndex).toBe(-1);
    expect(warn).toHaveBeenCalledWith("encoder key switch failed", expect.any(Error));
    // A later rotation starts clean and succeeds.
    failNext = false;
    mgr.onParticipantLeft(B);
    await mgr.onParticipantJoined(A);
    await vi.advanceTimersByTimeAsync(ROTATE_DEBOUNCE_MS + USE_KEY_DELAY_MS);
    expect(mgr.currentIndex).toBe(1);
  });

  it("warns (does not throw) when a send fails", async () => {
    const setKeys: SetKeyCall[] = [];
    const warn = vi.fn();
    const mgr = new ChannelKeyManager({
      roomName: ROOM,
      myPubkey: ME,
      sink: { async setSenderKey(identity, keyBytes, keyIndex) { setKeys.push({ identity, key: bytesToHex(keyBytes), idx: keyIndex }); } },
      send: async (to) => { if (to === A) throw new Error("relay down"); },
      warn,
    });
    await expect(mgr.start([A, B])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/send to aaaaaaaa failed/), expect.any(Error));
  });
});
