/**
 * Call lifecycle probes (audit #6 remainder, #9 media wiring, #37, #43).
 *
 * pre-fix behaviors these pin down:
 *  - #6: hangup published `disconnect` with NO p-tag, but the partner's
 *    subscription filter ANDs #r with #p — remote hangups never arrived.
 *    And reacting to a received disconnect re-published one (echo).
 *  - #37: the UI dispatched the clearing reducer BEFORE the service read
 *    incomingCall — the call_decline was never sent, callers rang 30s.
 *  - #43: the ring timer matched on state alone — a stale timer from call A
 *    could kill a later call B.
 *  - C4 controls: mute/camera flags were cosmetic — tracks kept transmitting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const pubRtc = vi.fn((..._a: unknown[]) => Promise.resolve());
const giftWrap = vi.fn(async (..._a: unknown[]) => ({ wrap: { id: "w" } }));
const selfWrap = vi.fn(async (..._a: unknown[]) => ({ wrap: { id: "s" } }));
const micEnabled = vi.fn(async (_e: boolean) => {});
const camEnabled = vi.fn(async (_e: boolean) => {});

let roomCounter = 0;

vi.mock("@/lib/nostr/callSignaling", () => ({
  publishRTCSignal: (...a: unknown[]) => pubRtc(...a),
  createCallRoom: vi.fn(() => ({
    secretKey: new Uint8Array(32).fill(1),
    roomId: `room-${++roomCounter}`,
  })),
  secretKeyToHex: vi.fn(() => "01".repeat(32)),
  hexToSecretKey: vi.fn(() => new Uint8Array(32).fill(1)),
}));
vi.mock("@/lib/webrtc/peerConnection", () => ({
  getActivePeerConnection: vi.fn(() => null),
  setRemoteDescription: vi.fn(async () => {}),
  createAnswer: vi.fn(async () => ({ type: "answer", sdp: "x" })),
  createOffer: vi.fn(async () => ({ type: "offer", sdp: "x" })),
  addIceCandidate: vi.fn(async () => {}),
  createPeerConnection: vi.fn(() => ({})),
  addMediaTracks: vi.fn(),
  closePeerConnection: vi.fn(),
}));
vi.mock("@/lib/webrtc/livekitClient", () => ({
  connectToRoom: vi.fn(async () => ({})),
  disconnectFromRoom: vi.fn(async () => {}),
  setMicrophoneEnabled: (e: boolean) => micEnabled(e),
  setCameraEnabled: (e: boolean) => camEnabled(e),
  setScreenShareEnabled: vi.fn(async () => {}),
}));
vi.mock("@/lib/nostr/giftWrap", () => ({
  createGiftWrappedDM: (...a: unknown[]) => giftWrap(...a),
  createSelfWrap: (...a: unknown[]) => selfWrap(...a),
}));
vi.mock("@/lib/nostr/relayManager", () => ({
  relayManager: {
    publish: vi.fn(),
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

interface FakeMediaTrack {
  kind: string;
  enabled: boolean;
  stop: ReturnType<typeof vi.fn>;
}
function makeFakeStream() {
  const audio: FakeMediaTrack = { kind: "audio", enabled: true, stop: vi.fn() };
  const video: FakeMediaTrack = { kind: "video", enabled: true, stop: vi.fn() };
  return {
    audio,
    video,
    stream: {
      getAudioTracks: () => [audio],
      getVideoTracks: () => [video],
      getTracks: () => [audio, video],
    } as unknown as MediaStream,
  };
}
let lastStream = makeFakeStream();
vi.mock("@/lib/webrtc/mediaDevices", () => ({
  getUserMedia: vi.fn(async () => {
    lastStream = makeFakeStream();
    return lastStream.stream;
  }),
  stopMediaStream: vi.fn(),
}));
vi.mock("@/lib/api/voice", () => ({
  fetchDMVoiceToken: vi.fn(async () => ({ token: "t", url: "wss://x" })),
}));

import {
  initiateCall,
  answerCall,
  rejectCall,
  hangupCall,
  handleRTCSignal,
  setCallMuted,
  setCallVideoEnabled,
} from "../callService";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import {
  setIncomingCall,
  acceptCall,
  setCallState,
  setSfuFallback,
} from "@/store/slices/callSlice";
import type { RTCSignalPayload } from "@/types/calling";

const ME = "f".repeat(64);
const PARTNER = "a".repeat(64);
const PARTNER_B = "b".repeat(64);

function seedIncoming(callType: "audio" | "video" = "audio") {
  store.dispatch(
    setIncomingCall({
      callerPubkey: PARTNER,
      roomSecretKey: "01".repeat(32),
      callType,
      callerName: "partner",
      timestamp: Date.now(),
    }),
  );
}

beforeEach(() => {
  store.dispatch(resetAll());
  store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
  pubRtc.mockClear();
  giftWrap.mockClear();
  selfWrap.mockClear();
  micEnabled.mockClear();
  camEnabled.mockClear();
});

afterEach(async () => {
  // Drain any active call so module-level timers/streams can't leak between tests
  await hangupCall().catch(() => {});
  vi.useRealTimers();
});

describe("#6 — remote hangup delivery", () => {
  it("hangup publishes disconnect WITH the partner p-tag", async () => {
    await initiateCall(PARTNER, "audio");
    const roomId = store.getState().call.activeCall!.roomId;
    pubRtc.mockClear();

    await hangupCall();

    // (data, targetRelays) are undefined here — the mocks expose no DM relays
    expect(pubRtc).toHaveBeenCalledWith("disconnect", roomId, PARTNER, undefined, undefined);
  });

  it("a received disconnect ends the call WITHOUT echoing a disconnect back", async () => {
    await initiateCall(PARTNER, "audio");
    store.dispatch(setCallState("active"));
    const roomId = store.getState().call.activeCall!.roomId;
    pubRtc.mockClear();

    const signal: RTCSignalPayload = {
      type: "disconnect",
      roomId,
      senderPubkey: PARTNER,
    };
    await handleRTCSignal(signal);

    expect(store.getState().call.activeCall).toBeNull();
    expect(pubRtc).not.toHaveBeenCalledWith("disconnect", expect.anything(), expect.anything());
  });
});

describe("#37 — decline ordering", () => {
  it("rejectCall sends call_decline AND clears the invite (capture before dispatch)", async () => {
    seedIncoming();

    await rejectCall();

    expect(store.getState().call.incomingCall).toBeNull();
    expect(store.getState().call.callHistory[0]).toMatchObject({
      direction: "incoming",
      outcome: "declined",
    });
    expect(giftWrap).toHaveBeenCalledWith("", PARTNER, [["type", "call_decline"]]);
  });

  it("rejectCall is a no-op when there is no invite", async () => {
    await rejectCall();
    expect(giftWrap).not.toHaveBeenCalled();
  });
});

describe("#43 — ring timer scoping", () => {
  it("a stale ring timer from call A cannot kill a later call B", async () => {
    vi.useFakeTimers();

    await initiateCall(PARTNER, "audio"); // call A, timer at t0+30s
    await vi.advanceTimersByTimeAsync(1000);
    await hangupCall(); // A ends at t0+1s

    await vi.advanceTimersByTimeAsync(1000);
    await initiateCall(PARTNER_B, "audio"); // call B at t0+2s

    // Cross A's original 30s deadline — B (ringing) must survive
    await vi.advanceTimersByTimeAsync(29_000);
    const active = store.getState().call.activeCall;
    expect(active?.partnerPubkey).toBe(PARTNER_B);
    expect(active?.state).toBe("ringing");
  });

  it("hangup clears the ring timer — no call_missed fires afterwards", async () => {
    vi.useFakeTimers();

    await initiateCall(PARTNER, "audio");
    await hangupCall();
    giftWrap.mockClear();

    await vi.advanceTimersByTimeAsync(31_000);

    expect(giftWrap).not.toHaveBeenCalledWith("", PARTNER, [["type", "call_missed"]]);
    const missed = store.getState().call.callHistory.filter((h) => h.outcome === "missed");
    expect(missed).toHaveLength(0);
  });

  it("an unanswered outgoing call still times out to missed", async () => {
    vi.useFakeTimers();

    await initiateCall(PARTNER, "audio");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(store.getState().call.activeCall).toBeNull();
    expect(store.getState().call.callHistory[0]?.outcome).toBe("missed");
    expect(giftWrap).toHaveBeenCalledWith("", PARTNER, [["type", "call_missed"]]);
  });
});

describe("C4 — call controls drive real media", () => {
  it("P2P mute disables the transmitted audio track (and unmute restores it)", async () => {
    seedIncoming("audio");
    store.dispatch(acceptCall());
    await answerCall();

    await setCallMuted(true);
    expect(lastStream.audio.enabled).toBe(false);

    await setCallMuted(false);
    expect(lastStream.audio.enabled).toBe(true);
  });

  it("P2P camera-off disables the transmitted video track (privacy)", async () => {
    seedIncoming("video");
    store.dispatch(acceptCall());
    await answerCall();

    await setCallVideoEnabled(false);
    expect(lastStream.video.enabled).toBe(false);
  });

  it("SFU mute routes through LiveKit setMicrophoneEnabled", async () => {
    seedIncoming("audio");
    store.dispatch(acceptCall());
    await answerCall();
    store.dispatch(setSfuFallback(true));

    await setCallMuted(true);
    expect(micEnabled).toHaveBeenCalledWith(false);
  });
});
