/**
 * 1:1 DM calls — SFU-first.
 *
 * A call is a private LiveKit room named `dm:<roomId>`, where roomId is the
 * pubkey of a fresh secret key that travels to the callee inside the
 * NIP-17 `call_invite` gift wrap (the secret is kept for the planned
 * frame-level E2EE key derivation — see docs/E2EE_CALLS.md).
 *
 * Flow:
 *   caller  → invite gift wrap + joins the room immediately   (ringing)
 *   callee  → accepts → joins the same room                    (connecting)
 *   both    → ParticipantConnected(partner)                    (active)
 *   either  → room.disconnect(); the peer sees ParticipantDisconnected
 *
 * The old P2P path (kind:25050 offer/answer/ICE over relays, SFU fallback
 * after ICE failure) is gone: it had no TURN, no renegotiation (so no
 * screen share / camera toggle), and spent 15–30s "Connecting…" before
 * giving up. Decline / missed / cancel still use gift wraps because the
 * callee is not in the room yet when those happen.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { store } from "@/store";
import {
  startOutgoingCall,
  setCallState,
  setCallRoomId,
  endCall,
  rejectCall as rejectCallAction,
  toggleCallMute,
  toggleCallVideo,
} from "@/store/slices/callSlice";
import { setMediaError } from "@/store/slices/voiceSlice";
import { createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays } from "@/lib/nostr/dmRelayList";
import { fetchDMVoiceToken } from "@/lib/api/voice";
import {
  connectToRoom,
  disconnectFromRoom,
  setMicrophoneEnabled,
  setCameraEnabled,
  setScreenShareEnabled,
  addRoomListener,
  getLivekitRoom,
} from "@/lib/webrtc/livekitClient";
import { describeMediaError } from "@/lib/webrtc/mediaDevices";
import { createLogger } from "@/lib/debug/logger";
import type { CallType, CallTransport } from "@/types/calling";

// Gated "call" category (wiredDebug.enable("call")); warn/error always print.
const clog = createLogger("call");
const log = (msg: string, data?: unknown) => clog.info(msg, data);
const warn = (msg: string, data?: unknown) => clog.warn(msg, data);
const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : "?");

export const CALL_TRANSPORT: CallTransport = "sfu";

/** How long the caller rings before giving up. */
const RING_TIMEOUT_MS = 30_000;
/** How long the callee waits for the caller to show up in the room. */
const CONNECT_TIMEOUT_MS = 30_000;

/** Outgoing-call ring timeout — cleared on hangup/answer so a stale timer
 *  from call A can never tear down a later call B (#43). */
let ringTimer: ReturnType<typeof setTimeout> | null = null;
/** Callee-side "caller never arrived" timeout. */
let connectTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers(): void {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

/** Initiate a 1:1 call to a DM partner. */
export async function initiateCall(
  partnerPubkey: string,
  callType: CallType,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  if (store.getState().call.activeCall) throw new Error("Already in a call");

  const secretKey = generateSecretKey();
  const roomId = getPublicKey(secretKey);
  const roomSecretKeyHex = bytesToHex(secretKey);

  log(`initiate partner=${shortId(partnerPubkey)} type=${callType} room=${shortId(roomId)}`);

  store.dispatch(
    startOutgoingCall({
      partnerPubkey,
      callType,
      roomId,
      roomSecretKey: roomSecretKeyHex,
    }),
  );

  const invitePayload = JSON.stringify({
    roomSecretKey: roomSecretKeyHex,
    callType,
    callerName: myPubkey,
    transport: CALL_TRANSPORT,
  });

  const [recipientResult, selfResult] = await Promise.all([
    createGiftWrappedDM(invitePayload, partnerPubkey, [["type", "call_invite"]]),
    createSelfWrap(invitePayload, partnerPubkey, [["type", "call_invite"]]),
  ]);

  const partnerRelays = await getDMRelaysForPublish(partnerPubkey);
  const ownRelays = await getOwnDMRelays();

  relayManager.publish(recipientResult.wrap, partnerRelays);
  relayManager.publish(selfResult.wrap, ownRelays);

  // Capture the roomId so the timeout can only ever end THIS call (#43).
  clearTimers();
  const ringRoomId = roomId;
  ringTimer = setTimeout(() => {
    ringTimer = null;
    const state = store.getState().call;
    if (state.activeCall?.roomId === ringRoomId && state.activeCall.state === "ringing") {
      log(`ringing timeout → missed`);
      void sendCallStatus(partnerPubkey, "call_missed");
      void disconnectFromRoom();
      store.dispatch(endCall("missed"));
    }
  }, RING_TIMEOUT_MS);

  // Join the room now so the callee lands straight into a live call.
  try {
    await joinCallRoom(partnerPubkey, roomId);
  } catch (err) {
    warn(`could not join call room:`, err);
    store.dispatch(setMediaError(describeMediaError(err)));
    clearTimers();
    store.dispatch(endCall("failed"));
    throw err;
  }
}

/**
 * Answer an incoming call.
 *
 * Called after the `acceptCall` reducer has moved the invite into `activeCall`
 * (so `incomingCall` is already null at this point — read from `activeCall`).
 */
export async function answerCall(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) throw new Error("No active call");

  const { partnerPubkey: callerPubkey, roomSecretKey, callType } = activeCall;
  const roomId = getPublicKey(hexToBytes(roomSecretKey));

  log(`answer caller=${shortId(callerPubkey)} type=${callType} room=${shortId(roomId)}`);

  store.dispatch(setCallRoomId(roomId));
  store.dispatch(setCallState("connecting"));

  // If the caller never shows up (crashed, or a legacy client waiting for
  // P2P signaling we no longer send) don't sit on "Connecting…" forever.
  clearTimers();
  connectTimer = setTimeout(() => {
    connectTimer = null;
    const c = store.getState().call.activeCall;
    if (c?.roomId === roomId && c.state !== "active") {
      warn(`caller never joined the room — giving up`);
      void hangupCall({ notifyPeer: false, outcome: "failed" });
    }
  }, CONNECT_TIMEOUT_MS);

  try {
    await joinCallRoom(callerPubkey, roomId);
  } catch (err) {
    warn(`could not join call room:`, err);
    store.dispatch(setMediaError(describeMediaError(err)));
    await hangupCall({ notifyPeer: false, outcome: "failed" });
    throw err;
  }
}

/**
 * Reject an incoming call.
 *
 * Captures the invite BEFORE dispatching the clearing reducer (#37) — the
 * ordering invariant lives here, like `answerCall`. Callers must NOT
 * dispatch `rejectCall` themselves first or the decline is never sent.
 */
export async function rejectCall(): Promise<void> {
  const incomingCall = store.getState().call.incomingCall;
  if (!incomingCall) return;
  log(`reject caller=${shortId(incomingCall.callerPubkey)}`);
  store.dispatch(rejectCallAction());
  await sendCallStatus(incomingCall.callerPubkey, "call_decline");
}

/**
 * Hang up the current call.
 *
 * Leaving the LiveKit room is the hangup signal: the peer sees
 * ParticipantDisconnected. The one case with no in-room peer yet is the
 * caller cancelling while still ringing — then a `call_missed` gift wrap
 * stops the callee's ring. `notifyPeer: false` skips that (used when the
 * hangup IS the reaction to the peer leaving).
 */
export async function hangupCall(
  opts: { notifyPeer?: boolean; outcome?: "completed" | "missed" | "declined" | "failed" } = {},
): Promise<void> {
  const { notifyPeer = true, outcome = "completed" } = opts;
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  log(`hangup partner=${shortId(activeCall.partnerPubkey)} state=${activeCall.state} outcome=${outcome}`);
  clearTimers();

  if (notifyPeer && activeCall.direction === "outgoing" && activeCall.state === "ringing") {
    await sendCallStatus(activeCall.partnerPubkey, "call_missed");
  }

  await disconnectFromRoom();
  store.dispatch(endCall(outcome));
}

/** Fetch a token, join the call room, publish local media. */
async function joinCallRoom(partnerPubkey: string, roomId: string): Promise<void> {
  const { token, url } = await fetchDMVoiceToken(partnerPubkey, roomId);
  await connectToRoom(url, token);

  // Hung up while the token/connect round-trips were in flight — don't
  // leave an orphaned room connection behind.
  if (store.getState().call.activeCall?.roomId !== roomId) {
    log(`call ended during connect — leaving room`);
    await disconnectFromRoom();
    return;
  }

  await publishLocalMedia();

  // Partner may already be in the room (we are the second to join).
  const room = getLivekitRoom();
  if (room?.remoteParticipants.has(partnerPubkey)) markActive();
}

/** Publish mic (and camera for video calls), honoring the call's flags. */
async function publishLocalMedia(): Promise<void> {
  const call = store.getState().call.activeCall;
  if (!call) return;

  try {
    await setMicrophoneEnabled(!call.isMuted);
  } catch (err) {
    warn(`mic publish failed:`, err);
    store.dispatch(setMediaError(describeMediaError(err, "microphone")));
    if (!call.isMuted) store.dispatch(toggleCallMute());
  }

  if (call.callType === "video" && call.isVideoEnabled) {
    try {
      await setCameraEnabled(true);
    } catch (err) {
      warn(`camera publish failed:`, err);
      store.dispatch(setMediaError(describeMediaError(err, "camera")));
      store.dispatch(toggleCallVideo());
    }
  }
}

function markActive(): void {
  clearTimers();
  const call = store.getState().call.activeCall;
  if (call && call.state !== "active") {
    log(`partner present → active`);
    store.dispatch(setCallState("active"));
  }
}

// React to the shared LiveKit room: partner joins → active; partner leaves
// → hang up (without echoing anything); the transport drops → failed.
addRoomListener({
  onParticipantConnected(identity) {
    const call = store.getState().call.activeCall;
    if (call && identity === call.partnerPubkey) markActive();
  },
  onParticipantDisconnected(identity) {
    const call = store.getState().call.activeCall;
    if (call && identity === call.partnerPubkey && call.state === "active") {
      log(`partner left → ending call`);
      void hangupCall({ notifyPeer: false });
    }
  },
  onDisconnected(_reason, clientInitiated) {
    if (clientInitiated) return;
    const call = store.getState().call.activeCall;
    if (call) {
      warn(`room dropped mid-call → failed`);
      clearTimers();
      store.dispatch(endCall("failed"));
    }
  },
});

/** Send a call status notification via gift wrap. */
async function sendCallStatus(
  partnerPubkey: string,
  type: "call_decline" | "call_missed",
): Promise<void> {
  try {
    const { wrap } = await createGiftWrappedDM("", partnerPubkey, [["type", type]]);
    const relays = await getDMRelaysForPublish(partnerPubkey);
    relayManager.publish(wrap, relays);
  } catch (e) {
    warn(`Failed to send ${type}:`, e);
  }
}

/**
 * Apply mute to the transmitted audio. The Redux flag alone is cosmetic —
 * without this the partner keeps hearing you while the button shows muted.
 */
export async function setCallMuted(muted: boolean): Promise<void> {
  if (!store.getState().call.activeCall) return;
  await setMicrophoneEnabled(!muted);
}

/**
 * Apply camera on/off to the transmitted video. Privacy-critical: the local
 * PiP hides when "off", so the user can't tell the camera is still
 * streaming unless the track is actually disabled.
 */
export async function setCallVideoEnabled(enabled: boolean): Promise<void> {
  if (!store.getState().call.activeCall) return;
  await setCameraEnabled(enabled);
}

/** Screen share for 1:1 calls (available in every call now — it's an SFU room). */
export async function setCallScreenShare(enabled: boolean): Promise<void> {
  if (!store.getState().call.activeCall) return;
  await setScreenShareEnabled(enabled);
}
