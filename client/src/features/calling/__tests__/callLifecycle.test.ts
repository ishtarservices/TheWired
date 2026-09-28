/**
 * 1:1 call lifecycle on the SFU-first transport.
 *
 * pre-fix behaviors these pin down (P2P era):
 *  - the caller only joined media after a `connect` signal → 15–30s of
 *    "Connecting…" when ICE failed; now the caller is in the room before
 *    the callee even picks up.
 *  - a caller hanging up while ringing never reached the callee (they were
 *    not subscribed to signals yet) → the callee rang for 60s.
 *  - #37 decline ordering, #43 stale ring-timer scoping, C4 "controls drive
 *    real media" are preserved from the old suite.
 *
 * E2EE (docs/E2EE_CALLS.md): every call is encrypted. The invite advertises
 * `caps.e2ee`, the room is joined with the derived-key context, a legacy
 * invite is declined instead of answered, an unsupported WebView refuses to
 * call, and a partner publishing plaintext ends the call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DM_EXPIRATION_SECONDS } from "@ishtarservices/shared-types";

/** Just past the caller ring timeout, which tracks the wire TTL. */
const PAST_RING_TIMEOUT_MS = DM_EXPIRATION_SECONDS.call * 1000 + 1_000;
/** Just past the callee's separate "caller never arrived" timeout (30s). */
const PAST_CONNECT_TIMEOUT_MS = 31_000;

const h = vi.hoisted(() => {
  type Listener = {
    onParticipantConnected?(identity: string): void;
    onParticipantDisconnected?(identity: string): void;
    onDisconnected?(reason: unknown, clientInitiated: boolean): void;
    onParticipantEncryption?(identity: string, encrypted: boolean): void;
  };
  return {
    listeners: [] as Listener[],
    remoteParticipants: new Map<string, unknown>(),
    connectRoom: vi.fn(async (_url: string, _token: string, _opts?: unknown) => ({})),
    e2eeSupported: true,
    disconnectRoom: vi.fn(async () => {}),
    micEnabled: vi.fn(async (_e: boolean) => {}),
    camEnabled: vi.fn(async (_e: boolean) => {}),
    screenEnabled: vi.fn(async (_e: boolean) => {}),
    fetchToken: vi.fn(async (_partner: string, _roomId: string) => ({ token: "t", url: "wss://x", roomName: "r" })),
    giftWrap: vi.fn(async (..._a: unknown[]) => ({ wrap: { id: "w" } })),
    selfWrap: vi.fn(async (..._a: unknown[]) => ({ wrap: { id: "s" } })),
    publish: vi.fn(),
  };
});

vi.mock("@/lib/webrtc/e2ee/session", () => ({
  e2eeSupported: () => h.e2eeSupported,
  E2EEUnsupportedError: class E2EEUnsupportedError extends Error {
    constructor() {
      super("End-to-end encrypted calls aren't supported on this device");
      this.name = "E2EEUnsupportedError";
    }
  },
}));
vi.mock("@/lib/webrtc/livekitClient", () => ({
  connectToRoom: (...a: [string, string, unknown]) => h.connectRoom(...a),
  disconnectFromRoom: () => h.disconnectRoom(),
  setMicrophoneEnabled: (e: boolean) => h.micEnabled(e),
  setCameraEnabled: (e: boolean) => h.camEnabled(e),
  setScreenShareEnabled: (e: boolean) => h.screenEnabled(e),
  addRoomListener: (l: (typeof h.listeners)[number]) => {
    h.listeners.push(l);
    return () => {};
  },
  getLivekitRoom: () => ({ remoteParticipants: h.remoteParticipants }),
}));
vi.mock("@/lib/api/voice", () => ({
  fetchDMVoiceToken: (p: string, r: string) => h.fetchToken(p, r),
}));
vi.mock("@/lib/nostr/giftWrap", () => ({
  createGiftWrappedDM: (...a: unknown[]) => h.giftWrap(...a),
  createSelfWrap: (...a: unknown[]) => h.selfWrap(...a),
}));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: {
    publish: (...a: unknown[]) => h.publish(...a),
    onReconnect: vi.fn(() => () => {}),
    subscribe: vi.fn(() => "sub"),
    closeSubscription: vi.fn(),
    getWriteRelays: vi.fn(() => []),
  },
}));
vi.mock("@/lib/nostr/dmRelayList", () => ({
  getDMRelaysForPublish: vi.fn(async () => []),
  getOwnDMRelays: vi.fn(async () => []),
}));

import {
  initiateCall,
  answerCall,
  rejectCall,
  hangupCall,
  setCallMuted,
  setCallVideoEnabled,
  declineLegacyInvite,
} from "../callService";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { setIncomingCall, acceptCall } from "@/store/slices/callSlice";

const ME = "f".repeat(64);
const PARTNER = "a".repeat(64);
const PARTNER_B = "b".repeat(64);
const STRANGER = "e".repeat(64);
const SECRET = "01".repeat(32);

const listener = () => h.listeners[h.listeners.length - 1];
const call = () => store.getState().call.activeCall;

/** Gift wraps sent with a given type tag. */
const wrapsOfType = (type: string) =>
  h.giftWrap.mock.calls.filter((c) => (c[2] as string[][])?.some((t) => t[0] === "type" && t[1] === type));

function seedIncoming(callType: "audio" | "video" = "audio", caps: { e2ee?: boolean } = { e2ee: true }) {
  store.dispatch(
    setIncomingCall({
      callerPubkey: PARTNER,
      roomSecretKey: SECRET,
      callType,
      callerName: "partner",
      timestamp: Date.now(),
      transport: "sfu",
      caps,
    }),
  );
}

const E2EE_CTX = (roomId: string) => ({
  e2ee: { kind: "call", roomId, roomSecretKeyHex: expect.stringMatching(/^[0-9a-f]{64}$/), peerPubkey: PARTNER },
});

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  h.remoteParticipants.clear();
  h.e2eeSupported = true;
  for (const fn of [h.connectRoom, h.disconnectRoom, h.micEnabled, h.camEnabled, h.screenEnabled, h.fetchToken, h.giftWrap, h.selfWrap, h.publish]) {
    fn.mockClear();
  }
});

afterEach(async () => {
  await hangupCall({ notifyPeer: false }).catch(() => {});
  vi.useRealTimers();
});

describe("outgoing call", () => {
  it("sends an SFU invite and joins the room before the callee answers", async () => {
    await initiateCall(PARTNER, "video");

    const c = call()!;
    expect(c.state).toBe("ringing");
    expect(c.direction).toBe("outgoing");

    const invite = wrapsOfType("call_invite");
    expect(invite).toHaveLength(1);
    const payload = JSON.parse(invite[0][0] as string);
    expect(payload.transport).toBe("sfu");
    expect(payload.roomSecretKey).toHaveLength(64);
    expect(payload.callType).toBe("video");
    expect(payload.caps).toEqual({ e2ee: true });
    expect(c.e2ee).toBe(true);

    expect(h.fetchToken).toHaveBeenCalledWith(PARTNER, c.roomId);
    expect(h.connectRoom).toHaveBeenCalledWith("wss://x", "t", E2EE_CTX(c.roomId));
    expect((h.connectRoom.mock.calls[0][2] as { e2ee: { roomSecretKeyHex: string } }).e2ee.roomSecretKeyHex).toBe(
      c.roomSecretKey,
    );
    expect(h.micEnabled).toHaveBeenCalledWith(true);
    expect(h.camEnabled).toHaveBeenCalledWith(true);
  });

  it("goes active (and stamps connectedAt) when the partner joins the room", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(STRANGER);
    expect(call()!.state).toBe("ringing");

    listener().onParticipantConnected?.(PARTNER);
    expect(call()!.state).toBe("active");
    expect(call()!.connectedAt).toBeTypeOf("number");
  });

  it("refuses to start a second call while one is active", async () => {
    await initiateCall(PARTNER, "audio");
    await expect(initiateCall(PARTNER_B, "audio")).rejects.toThrow(/already/i);
    expect(call()!.partnerPubkey).toBe(PARTNER);
  });

  it("cancels the already-published invite if the room cannot be joined", async () => {
    vi.useFakeTimers();
    h.fetchToken.mockRejectedValueOnce(new Error("no livekit"));
    await expect(initiateCall(PARTNER, "audio")).rejects.toThrow();
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
    // The invite went out BEFORE the join, so the callee is ringing on it.
    // Failing silently left them ringing for the full expiration against a
    // caller that had already given up.
    expect(wrapsOfType("call_missed")).toHaveLength(1);
    // ...and exactly once: the ring timer must not fire a second cancel.
    await vi.advanceTimersByTimeAsync(PAST_RING_TIMEOUT_MS);
    expect(wrapsOfType("call_missed")).toHaveLength(1);
  });

  it("clears the call if the invite itself cannot be built or sent", async () => {
    h.giftWrap.mockRejectedValueOnce(new Error("no signer"));
    await expect(initiateCall(PARTNER, "audio")).rejects.toThrow();
    // `startOutgoingCall` is dispatched before the wraps are built, so a throw
    // here used to strand the UI on "Ringing..." forever with nothing sent.
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
    // Nothing was published, so there is nothing to cancel.
    expect(wrapsOfType("call_missed")).toHaveLength(0);
  });
});

describe("hangup semantics", () => {
  it("cancelling while ringing tells the callee (call_missed) and leaves the room", async () => {
    await initiateCall(PARTNER, "audio");
    await hangupCall();
    expect(wrapsOfType("call_missed")).toHaveLength(1);
    expect(h.disconnectRoom).toHaveBeenCalled();
    expect(call()).toBeNull();
  });

  it("hanging up an active call only leaves the room — no gift wrap", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER);
    h.giftWrap.mockClear();
    await hangupCall();
    expect(h.giftWrap).not.toHaveBeenCalled();
    expect(h.disconnectRoom).toHaveBeenCalled();
    expect(store.getState().call.callHistory[0].outcome).toBe("completed");
  });

  it("the partner leaving the room ends the call without echoing anything", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER);
    h.giftWrap.mockClear();
    h.disconnectRoom.mockClear();

    listener().onParticipantDisconnected?.(STRANGER);
    expect(call()).not.toBeNull();

    listener().onParticipantDisconnected?.(PARTNER);
    await Promise.resolve();
    await Promise.resolve();
    expect(call()).toBeNull();
    expect(h.giftWrap).not.toHaveBeenCalled();
    expect(h.disconnectRoom).toHaveBeenCalled();
  });

  it("a non-client room drop mid-call ends the call as failed; our own disconnect does not", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER);

    listener().onDisconnected?.(1, true);
    expect(call()).not.toBeNull();

    listener().onDisconnected?.(3, false);
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
  });
});

describe("#37 — decline ordering", () => {
  it("rejectCall sends call_decline AND clears the invite (capture before dispatch)", async () => {
    seedIncoming();
    await rejectCall();
    expect(wrapsOfType("call_decline")).toHaveLength(1);
    expect(store.getState().call.incomingCall).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("declined");
  });

  it("rejectCall is a no-op when there is no invite", async () => {
    await rejectCall();
    expect(h.giftWrap).not.toHaveBeenCalled();
  });
});

describe("answering", () => {
  it("joins the caller's room and is active immediately when the caller is already there", async () => {
    seedIncoming("audio");
    store.dispatch(acceptCall());
    h.remoteParticipants.set(PARTNER, {});
    await answerCall();

    const c = call()!;
    expect(c.roomId).toHaveLength(64);
    expect(h.fetchToken).toHaveBeenCalledWith(PARTNER, c.roomId);
    expect(c.state).toBe("active");
  });

  it("waits in connecting until the caller appears", async () => {
    seedIncoming("audio");
    store.dispatch(acceptCall());
    await answerCall();
    expect(call()!.state).toBe("connecting");
    listener().onParticipantConnected?.(PARTNER);
    expect(call()!.state).toBe("active");
  });

  it("gives up as failed if the caller never joins", async () => {
    vi.useFakeTimers();
    seedIncoming("audio");
    store.dispatch(acceptCall());
    await answerCall();
    await vi.advanceTimersByTimeAsync(PAST_CONNECT_TIMEOUT_MS);
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
  });
});

describe("#43 — ring timer scoping", () => {
  it("a stale ring timer from call A cannot kill a later call B", async () => {
    vi.useFakeTimers();
    await initiateCall(PARTNER, "audio");
    await hangupCall();
    await initiateCall(PARTNER_B, "audio");
    const roomB = call()!.roomId;

    await vi.advanceTimersByTimeAsync(PAST_RING_TIMEOUT_MS);
    // Call B's own ring timer fires too — but only for B, as "missed" of B.
    // The point: A's timer (cleared on hangup) never touched B before that.
    expect(store.getState().call.callHistory[0].partnerPubkey).toBe(PARTNER_B);
    expect(roomB).not.toBe("");
  });

  it("hangup clears the ring timer — no call_missed fires afterwards", async () => {
    vi.useFakeTimers();
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER); // answered
    await hangupCall();
    h.giftWrap.mockClear();
    await vi.advanceTimersByTimeAsync(PAST_RING_TIMEOUT_MS);
    expect(wrapsOfType("call_missed")).toHaveLength(0);
  });

  it("an unanswered outgoing call still times out to missed", async () => {
    vi.useFakeTimers();
    await initiateCall(PARTNER, "audio");
    await vi.advanceTimersByTimeAsync(PAST_RING_TIMEOUT_MS);
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("missed");
    expect(wrapsOfType("call_missed")).toHaveLength(1);
    expect(h.disconnectRoom).toHaveBeenCalled();
  });
});

describe("C4 — call controls drive real media", () => {
  it("mute routes through LiveKit setMicrophoneEnabled", async () => {
    await initiateCall(PARTNER, "audio");
    h.micEnabled.mockClear();
    await setCallMuted(true);
    expect(h.micEnabled).toHaveBeenCalledWith(false);
    await setCallMuted(false);
    expect(h.micEnabled).toHaveBeenCalledWith(true);
  });

  it("camera-off routes through LiveKit setCameraEnabled (privacy)", async () => {
    await initiateCall(PARTNER, "video");
    h.camEnabled.mockClear();
    await setCallVideoEnabled(false);
    expect(h.camEnabled).toHaveBeenCalledWith(false);
  });

  it("controls are no-ops with no active call", async () => {
    await setCallMuted(true);
    expect(h.micEnabled).not.toHaveBeenCalled();
  });
});

describe("E2EE", () => {
  it("answering joins the room with the derived-key context from the invite secret", async () => {
    seedIncoming("audio");
    store.dispatch(acceptCall());
    expect(call()!.e2ee).toBe(true);
    await answerCall();
    const roomId = call()!.roomId;
    expect(h.connectRoom).toHaveBeenCalledWith("wss://x", "t", E2EE_CTX(roomId));
    expect((h.connectRoom.mock.calls[0][2] as { e2ee: { roomSecretKeyHex: string } }).e2ee.roomSecretKeyHex).toBe(SECRET);
  });

  it("a legacy invite that reached activeCall is declined, never joined in plaintext", async () => {
    seedIncoming("audio", {});
    store.dispatch(acceptCall());
    expect(call()!.e2ee).toBe(false);
    await expect(answerCall()).rejects.toThrow(/end-to-end/i);
    expect(h.connectRoom).not.toHaveBeenCalled();
    expect(h.fetchToken).not.toHaveBeenCalled();
    expect(wrapsOfType("call_decline")).toHaveLength(1);
    // A human-style decline stays content-free; only the pipeline's
    // automatic legacy-invite refusal carries a reason.
    expect(wrapsOfType("call_decline")[0][0]).toBe("");
    expect(call()).toBeNull();
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
    expect(store.getState().call.notice).toMatchObject({ kind: "peer_outdated", pubkey: PARTNER });
  });

  it("an unsupported WebView refuses to place a call and says so", async () => {
    h.e2eeSupported = false;
    await expect(initiateCall(PARTNER, "audio")).rejects.toThrow(/supported on this device/);
    expect(call()).toBeNull();
    expect(wrapsOfType("call_invite")).toHaveLength(0);
    expect(store.getState().call.notice).toMatchObject({ kind: "unsupported_device", pubkey: PARTNER });
  });

  it("an unsupported WebView declines an incoming call instead of answering it", async () => {
    h.e2eeSupported = false;
    seedIncoming("audio");
    store.dispatch(acceptCall());
    await expect(answerCall()).rejects.toThrow();
    expect(h.connectRoom).not.toHaveBeenCalled();
    expect(wrapsOfType("call_decline")).toHaveLength(1);
    expect(store.getState().call.notice).toMatchObject({ kind: "unsupported_device" });
  });

  it("a partner whose tracks arrive unencrypted ends the call as failed (fail closed)", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER);
    expect(call()!.state).toBe("active");
    h.giftWrap.mockClear();
    listener().onParticipantEncryption?.(PARTNER, false);
    await vi.waitFor(() => expect(call()).toBeNull());
    expect(store.getState().call.callHistory[0].outcome).toBe("failed");
    expect(store.getState().call.notice).toMatchObject({ kind: "peer_outdated", pubkey: PARTNER });
    // Leaving the room IS the hangup; no gift wrap goes out for it.
    expect(wrapsOfType("call_missed")).toHaveLength(0);
    expect(h.disconnectRoom).toHaveBeenCalled();
  });

  it("an encrypted partner (or a stranger's status) does not touch the call", async () => {
    await initiateCall(PARTNER, "audio");
    listener().onParticipantConnected?.(PARTNER);
    listener().onParticipantEncryption?.(PARTNER, true);
    listener().onParticipantEncryption?.(STRANGER, false);
    expect(call()!.state).toBe("active");
  });

  it("declineLegacyInvite sends call_decline with reason e2ee_required and raises the outdated-peer notice", async () => {
    await declineLegacyInvite(PARTNER);
    const declines = wrapsOfType("call_decline");
    expect(declines).toHaveLength(1);
    expect(JSON.parse(declines[0][0] as string)).toEqual({ reason: "e2ee_required" });
    expect(store.getState().call.notice).toMatchObject({ kind: "peer_outdated", pubkey: PARTNER });
  });
});
