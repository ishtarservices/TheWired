import { store } from "@/store";
import {
  startOutgoingCall,
  setCallState,
  setCallRoomId,
  endCall,
  setSfuFallback,
} from "@/store/slices/callSlice";
import {
  createCallRoom,
  secretKeyToHex,
  hexToSecretKey,
  publishRTCSignal,
} from "@/lib/nostr/callSignaling";
import { createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays } from "@/lib/nostr/dmRelayList";
import {
  createPeerConnection,
  createOffer,
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  addMediaTracks,
  closePeerConnection,
  getActivePeerConnection,
} from "@/lib/webrtc/peerConnection";
import { getUserMedia, stopMediaStream } from "@/lib/webrtc/mediaDevices";
import { fetchDMVoiceToken } from "@/lib/api/voice";
import { connectToRoom, disconnectFromRoom } from "@/lib/webrtc/livekitClient";
import type { CallType, RTCSignalPayload } from "@/types/calling";

const log = (...args: unknown[]) => console.log("[call]", ...args);
const warn = (...args: unknown[]) => console.warn("[call]", ...args);
const err = (...args: unknown[]) => console.error("[call]", ...args);
const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : "?");

let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
/** ICE candidates that arrive before the PC has a remote description set. */
let pendingCandidates: RTCIceCandidateInit[] = [];
/** Grace timer for ICE "disconnected" — only fall back if it doesn't recover. */
let disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;

/** Initiate a 1:1 call to a DM partner. */
export async function initiateCall(
  partnerPubkey: string,
  callType: CallType,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const { secretKey, roomId } = createCallRoom();
  const roomSecretKeyHex = secretKeyToHex(secretKey);

  log(`initiate partner=${shortId(partnerPubkey)} type=${callType}`);

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
  });

  const [recipientResult, selfResult] = await Promise.all([
    createGiftWrappedDM(invitePayload, partnerPubkey, [["type", "call_invite"]]),
    createSelfWrap(invitePayload, partnerPubkey, [["type", "call_invite"]]),
  ]);

  const partnerRelays = await getDMRelaysForPublish(partnerPubkey);
  const ownRelays = await getOwnDMRelays();

  relayManager.publish(recipientResult.wrap, partnerRelays);
  relayManager.publish(selfResult.wrap, ownRelays);

  setTimeout(() => {
    const state = store.getState().call;
    if (state.activeCall?.state === "ringing") {
      log(`ringing timeout → missed`);
      sendCallStatus(partnerPubkey, "call_missed");
      store.dispatch(endCall("missed"));
    }
  }, 30000);
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

  const sk = hexToSecretKey(roomSecretKey);
  const roomId = (await import("nostr-tools/pure")).getPublicKey(sk);

  log(`answer caller=${shortId(callerPubkey)} type=${callType}`);

  store.dispatch(setCallRoomId(roomId));
  store.dispatch(setCallState("connecting"));

  localStream = await getUserMedia({
    audio: true,
    video: callType === "video",
  });

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      publishRTCSignal("candidate", roomId, callerPubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      });
    },
    onIceConnectionStateChange: (state) => onIceStateChange(state, callerPubkey, roomId),
    onTrack: (event) => {
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
    },
    onNegotiationNeeded: () => {},
    onIceGatheringComplete: () => {},
  });

  addMediaTracks(pc, localStream);

  await publishRTCSignal("connect", roomId, callerPubkey);
}

/** Reject an incoming call. */
export async function rejectCall(): Promise<void> {
  const incomingCall = store.getState().call.incomingCall;
  if (!incomingCall) return;
  log(`reject caller=${shortId(incomingCall.callerPubkey)}`);
  await sendCallStatus(incomingCall.callerPubkey, "call_decline");
}

/** Hang up the current call. */
export async function hangupCall(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  log(`hangup partner=${shortId(activeCall.partnerPubkey)} sfu=${activeCall.isSfuFallback}`);

  if (disconnectGraceTimer) {
    clearTimeout(disconnectGraceTimer);
    disconnectGraceTimer = null;
  }

  await publishRTCSignal("disconnect", activeCall.roomId, undefined).catch(() => {});

  if (localStream) {
    stopMediaStream(localStream);
    localStream = null;
  }
  remoteStream = null;
  pendingCandidates = [];

  closePeerConnection();

  if (activeCall.isSfuFallback) {
    await disconnectFromRoom();
  }

  store.dispatch(endCall("completed"));
}

/** Handle a received RTC signal. */
export async function handleRTCSignal(signal: RTCSignalPayload): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall || signal.roomId !== activeCall.roomId) return;

  switch (signal.type) {
    case "connect": {
      if (activeCall.state !== "ringing" || getActivePeerConnection()) return;
      await startCallerPeerConnection(activeCall.partnerPubkey, signal.roomId, activeCall.callType);
      break;
    }
    case "offer": {
      const pc = getActivePeerConnection();
      if (!pc || !signal.data?.offer) {
        warn(`got offer but pc=${!!pc} offer=${!!signal.data?.offer}`);
        return;
      }
      await setRemoteDescription(pc, signal.data.offer);
      await flushPendingCandidates(pc);
      const answer = await createAnswer(pc);
      await publishRTCSignal("answer", signal.roomId, signal.senderPubkey, { answer });
      break;
    }
    case "answer": {
      const pc = getActivePeerConnection();
      if (!pc || !signal.data?.answer) {
        warn(`got answer but pc=${!!pc} answer=${!!signal.data?.answer}`);
        return;
      }
      await setRemoteDescription(pc, signal.data.answer);
      await flushPendingCandidates(pc);
      break;
    }
    case "candidate": {
      const pc = getActivePeerConnection();
      if (!signal.data?.candidates) return;
      for (const candidate of signal.data.candidates) {
        if (!pc || !pc.remoteDescription) {
          pendingCandidates.push(candidate);
          continue;
        }
        await addIceCandidate(pc, candidate).catch((e) =>
          warn(`addIceCandidate failed: ${(e as Error).message}`),
        );
      }
      break;
    }
    case "disconnect": {
      await hangupCall();
      break;
    }
  }
}

/**
 * Caller-side WebRTC setup, triggered when the callee publishes "connect".
 * Creates the PeerConnection, acquires local media, and sends the SDP offer.
 */
async function startCallerPeerConnection(
  calleePubkey: string,
  roomId: string,
  callType: CallType,
): Promise<void> {
  store.dispatch(setCallState("connecting"));

  localStream = await getUserMedia({
    audio: true,
    video: callType === "video",
  });

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      publishRTCSignal("candidate", roomId, calleePubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      });
    },
    onIceConnectionStateChange: (state) => onIceStateChange(state, calleePubkey, roomId),
    onTrack: (event) => {
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
    },
    onNegotiationNeeded: () => {},
    onIceGatheringComplete: () => {},
  });

  addMediaTracks(pc, localStream);

  const offer = await createOffer(pc);
  await publishRTCSignal("offer", roomId, calleePubkey, { offer });
}

/**
 * Centralized ICE state handling so caller and callee share the same policy.
 *
 *  - "disconnected" is often transient (brief network blip, candidate reshuffle).
 *    Wait 5s for it to recover before falling back.
 *  - "failed" is terminal — fall back immediately.
 */
function onIceStateChange(
  state: RTCIceConnectionState,
  partnerPubkey: string,
  roomId: string,
): void {
  if (state === "connected" || state === "completed") {
    if (disconnectGraceTimer) {
      clearTimeout(disconnectGraceTimer);
      disconnectGraceTimer = null;
    }
    log(`P2P connected`);
    store.dispatch(setCallState("active"));
    return;
  }

  if (state === "failed") {
    handleP2PFailure(partnerPubkey, roomId);
    return;
  }

  if (state === "disconnected") {
    if (disconnectGraceTimer) return;
    disconnectGraceTimer = setTimeout(() => {
      disconnectGraceTimer = null;
      const pc = getActivePeerConnection();
      if (!pc) return;
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") return;
      handleP2PFailure(partnerPubkey, roomId);
    }, 5000);
  }
}

async function flushPendingCandidates(pc: RTCPeerConnection): Promise<void> {
  const buffered = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of buffered) {
    await addIceCandidate(pc, candidate).catch((e) =>
      warn(`flushPendingCandidates: ${(e as Error).message}`),
    );
  }
}

/** Handle P2P connection failure — fall back to SFU. */
async function handleP2PFailure(
  partnerPubkey: string,
  roomId: string,
): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall || activeCall.isSfuFallback) return;

  log(`P2P failed → SFU fallback`);

  closePeerConnection();
  pendingCandidates = [];

  try {
    const { token, url } = await fetchDMVoiceToken(partnerPubkey, roomId);
    await connectToRoom(url, token);
    log(`SFU connected`);
    store.dispatch(setSfuFallback(true));
    store.dispatch(setCallState("active"));
  } catch (e) {
    err(`SFU fallback failed:`, e);
    store.dispatch(endCall("failed"));
  }
}

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
 * Upgrade a P2P call to SFU mode for Listen Together DataChannel access.
 * No-op if already in SFU mode or no active call.
 */
export async function upgradeToSfuForListenTogether(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall || activeCall.isSfuFallback) return;

  log(`upgrade to SFU for Listen Together`);
  closePeerConnection();
  pendingCandidates = [];

  try {
    const { token, url } = await fetchDMVoiceToken(
      activeCall.partnerPubkey,
      activeCall.roomId,
    );
    await connectToRoom(url, token);
    store.dispatch(setSfuFallback(true));
  } catch (e) {
    err(`SFU upgrade failed:`, e);
  }
}

export function getLocalStream(): MediaStream | null {
  return localStream;
}

export function getRemoteStream(): MediaStream | null {
  return remoteStream;
}
