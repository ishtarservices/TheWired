/**
 * 1:1 DM calls — SFU-first.
 *
 * A call is a private LiveKit room named `dm:<roomId>`, where roomId is the
 * pubkey of a fresh secret key that travels to the callee inside the
 * NIP-17 `call_invite` gift wrap. Both peers derive their frame-level E2EE
 * sender keys from that secret (docs/E2EE_CALLS.md) — the SFU only ever
 * forwards ciphertext. Encryption is mandatory: an invite without
 * `caps.e2ee` (outdated caller) is declined, and a peer that joins the room
 * publishing plaintext ends the call.
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
  setCallNotice,
} from "@/store/slices/callSlice";
import { setMediaError } from "@/store/slices/voiceSlice";
import { createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { defaultExpirationFor } from "@ishtarservices/core";
import { DM_EXPIRATION_SECONDS, type CallDeclinePayload } from "@ishtarservices/shared-types";
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
import { e2eeSupported, E2EEUnsupportedError } from "@/lib/webrtc/e2ee/session";
import { describeMediaError } from "@/lib/webrtc/mediaDevices";
import { createLogger } from "@/lib/debug/logger";
import type { CallType, CallTransport } from "@/types/calling";

// Gated "call" category (wiredDebug.enable("call")); warn/error always print.
const clog = createLogger("call");
const log = (msg: string, data?: unknown) => clog.info(msg, data);
const warn = (msg: string, data?: unknown) => clog.warn(msg, data);
const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : "?");

export const CALL_TRANSPORT: CallTransport = "sfu";

/** How long the caller rings before giving up.
 *
 *  This MUST NOT undercut the invite's own expiration: the wrap stays valid
 *  on the relay for DM_EXPIRATION_SECONDS.call, and a callee whose delivery
 *  lagged (measured at up to ~25s against a mobile peer) would otherwise get
 *  only the remainder of a shorter window to answer — with the caller giving
 *  up while its own invite was still live. Derived, not a literal, so the two
 *  can't drift apart. */
const RING_TIMEOUT_MS = DM_EXPIRATION_SECONDS.call * 1000;
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
  if (!e2eeSupported()) {
    store.dispatch(setCallNotice({ kind: "unsupported_device", pubkey: partnerPubkey }));
    throw new E2EEUnsupportedError();
  }

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
      e2ee: true,
    }),
  );

  const invitePayload = JSON.stringify({
    roomSecretKey: roomSecretKeyHex,
    callType,
    callerName: myPubkey,
    transport: CALL_TRANSPORT,
    // Authenticated (it rides inside the sealed rumor): the callee knows we
    // will frame-encrypt, and nothing on the path can strip the flag.
    caps: { e2ee: true },
  });

  // Call signaling expires on the relay (docs/DM_WIRE_CONTRACT.md §5) — no
  // stale invites replaying on reconnect.
  const callWrapOpts = { expiration: defaultExpirationFor("call", Math.floor(Date.now() / 1000)) };

  // `startOutgoingCall` is already dispatched, so every exit from here on has
  // to clear it. A throw that escaped left the UI on "Ringing…" forever with
  // no invite sent and no ring timer armed (it is set below) — the caller was
  // told a call was in flight that did not exist.
  try {
    const [recipientResult, selfResult] = await Promise.all([
      createGiftWrappedDM(invitePayload, partnerPubkey, [["type", "call_invite"]], undefined, callWrapOpts),
      createSelfWrap(invitePayload, partnerPubkey, [["type", "call_invite"]], undefined, callWrapOpts),
    ]);

    const partnerRelays = await getDMRelaysForPublish(partnerPubkey);
    const ownRelays = await getOwnDMRelays();

    relayManager.publish(recipientResult.wrap, partnerRelays);
    relayManager.publish(selfResult.wrap, ownRelays);
  } catch (err) {
    warn(`could not send the invite:`, err);
    store.dispatch(endCall("failed"));
    throw err;
  }

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
    // The invite is already out there and the callee is ringing on it. Tell
    // them, or they ring for the full expiration against a caller that gave
    // up seconds in (mobile leaves no trace afterwards, so it just looks like
    // an ignored call).
    await sendCallStatus(partnerPubkey, "call_missed");
    void disconnectFromRoom();
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

  // Never join in plaintext. `activeCall.e2ee` is false only for a legacy
  // invite that slipped past the pipeline's auto-decline; an unsupported
  // WebView can't run the cryptor at all. Decline so the caller stops ringing.
  if (!activeCall.e2ee || !e2eeSupported()) {
    const kind = activeCall.e2ee ? "unsupported_device" : "peer_outdated";
    warn(`cannot answer encrypted call: ${kind}`);
    store.dispatch(setCallNotice({ kind, pubkey: callerPubkey }));
    clearTimers();
    store.dispatch(endCall("failed"));
    await sendCallStatus(callerPubkey, "call_decline");
    throw new E2EEUnsupportedError();
  }

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

/** Fetch a token, join the call room (encrypted), publish local media. */
async function joinCallRoom(partnerPubkey: string, roomId: string): Promise<void> {
  const call = store.getState().call.activeCall;
  if (!call || call.roomId !== roomId) throw new Error("Call ended before joining");
  const { token, url } = await fetchDMVoiceToken(partnerPubkey, roomId);
  await connectToRoom(url, token, {
    e2ee: {
      kind: "call",
      roomId,
      roomSecretKeyHex: call.roomSecretKey,
      peerPubkey: partnerPubkey,
    },
  });

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
  // Fail closed: a partner whose tracks arrive unencrypted is running a
  // client without E2EE. We would hear nothing (their plaintext fails our
  // decryptor) and they would hear noise — end it and say why.
  onParticipantEncryption(identity, encrypted) {
    const call = store.getState().call.activeCall;
    if (!call || identity !== call.partnerPubkey || encrypted) return;
    warn(`partner ${shortId(identity)} publishes plaintext → ending call`);
    store.dispatch(setCallNotice({ kind: "peer_outdated", pubkey: identity }));
    void hangupCall({ notifyPeer: false, outcome: "failed" });
  },
});

/**
 * An invite from a client that does not advertise `caps.e2ee` (older desktop
 * build, or a mobile build without media). We never ring for it: decline so
 * the caller stops ringing, and tell the user why (with a nudge to update).
 */
export async function declineLegacyInvite(callerPubkey: string): Promise<void> {
  log(`legacy (non-e2ee) invite from ${shortId(callerPubkey)} → declining`);
  store.dispatch(setCallNotice({ kind: "peer_outdated", pubkey: callerPubkey }));
  // The reason lets the caller's (older) client distinguish this automatic
  // refusal from a human decline (docs/DM_WIRE_CONTRACT.md §2).
  const payload: CallDeclinePayload = { reason: "e2ee_required" };
  await sendCallStatus(callerPubkey, "call_decline", JSON.stringify(payload));
}

/** Send a call status notification via gift wrap. */
async function sendCallStatus(
  partnerPubkey: string,
  type: "call_decline" | "call_missed",
  content = "",
): Promise<void> {
  try {
    const { wrap } = await createGiftWrappedDM(content, partnerPubkey, [["type", type]], undefined, {
      expiration: defaultExpirationFor("call", Math.floor(Date.now() / 1000)),
    });
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
