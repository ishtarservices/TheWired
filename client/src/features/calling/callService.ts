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
  createAnswer,
  setRemoteDescription,
  addIceCandidate,
  addMediaTracks,
  closePeerConnection,
} from "@/lib/webrtc/peerConnection";
import { getUserMedia, stopMediaStream } from "@/lib/webrtc/mediaDevices";
import { fetchDMVoiceToken } from "@/lib/api/voice";
import { connectToRoom, disconnectFromRoom } from "@/lib/webrtc/livekitClient";
import type { CallType, RTCSignalPayload } from "@/types/calling";

/** Active media stream for the current call */
let localStream: MediaStream | null = null;
/** Remote media stream */
let remoteStream: MediaStream | null = null;

/**
 * Initiate a 1:1 call to a DM partner.
 */
export async function initiateCall(
  partnerPubkey: string,
  callType: CallType,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Generate room
  const { secretKey, roomId } = createCallRoom();
  const roomSecretKeyHex = secretKeyToHex(secretKey);

  // Update Redux state
  store.dispatch(
    startOutgoingCall({
      partnerPubkey,
      callType,
      roomId,
      roomSecretKey: roomSecretKeyHex,
    }),
  );

  // Send call invitation via NIP-17 gift wrap
  const invitePayload = JSON.stringify({
    roomSecretKey: roomSecretKeyHex,
    callType,
    callerName: myPubkey,
  });

  const [recipientWrap, selfWrap] = await Promise.all([
    createGiftWrappedDM(invitePayload, partnerPubkey, [["type", "call_invite"]]),
    createSelfWrap(invitePayload, partnerPubkey, [["type", "call_invite"]]),
  ]);

  // Publish to partner's DM relays
  const partnerRelays = await getDMRelaysForPublish(partnerPubkey);
  const ownRelays = await getOwnDMRelays();

  relayManager.publish(recipientWrap, partnerRelays);
  relayManager.publish(selfWrap, ownRelays);

  // Start 30-second timeout for no answer
  setTimeout(() => {
    const state = store.getState().call;
    if (state.activeCall?.state === "ringing") {
      // Send missed call notification
      sendCallStatus(partnerPubkey, "call_missed");
      store.dispatch(endCall("missed"));
    }
  }, 30000);
}

/**
 * Answer an incoming call.
 */
export async function answerCall(): Promise<void> {
  const incomingCall = store.getState().call.incomingCall;
  if (!incomingCall) throw new Error("No incoming call");

  const { callerPubkey, roomSecretKey, callType } = incomingCall;

  // Derive room ID from secret key
  const sk = hexToSecretKey(roomSecretKey);
  const roomId = (await import("nostr-tools/pure")).getPublicKey(sk);

  store.dispatch(setCallRoomId(roomId));
  store.dispatch(setCallState("connecting"));

  // Get local media
  localStream = await getUserMedia({
    audio: true,
    video: callType === "video",
  });

  // Set up WebRTC peer connection
  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      publishRTCSignal("candidate", roomId, callerPubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      });
    },
    onIceConnectionStateChange: (state) => {
      if (state === "connected" || state === "completed") {
        store.dispatch(setCallState("active"));
      } else if (state === "failed" || state === "disconnected") {
        handleP2PFailure(callerPubkey, roomId);
      }
    },
    onTrack: (event) => {
      if (!remoteStream) {
        remoteStream = new MediaStream();
      }
      remoteStream.addTrack(event.track);
    },
    onNegotiationNeeded: () => {},
    onIceGatheringComplete: () => {},
  });

  // Add local tracks
  addMediaTracks(pc, localStream);

  // Publish connect signal
  await publishRTCSignal("connect", roomId, undefined);
}

/**
 * Reject an incoming call.
 */
export async function rejectCall(): Promise<void> {
  const incomingCall = store.getState().call.incomingCall;
  if (!incomingCall) return;

  await sendCallStatus(incomingCall.callerPubkey, "call_decline");
}

/**
 * Hang up the current call.
 */
export async function hangupCall(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  // Send disconnect signal
  await publishRTCSignal("disconnect", activeCall.roomId, undefined).catch(() => {});

  // Clean up media
  if (localStream) {
    stopMediaStream(localStream);
    localStream = null;
  }
  remoteStream = null;

  // Close P2P connection
  closePeerConnection();

  // Disconnect from SFU if in fallback mode
  if (activeCall.isSfuFallback) {
    await disconnectFromRoom();
  }

  store.dispatch(endCall("completed"));
}

/**
 * Handle a received RTC signal.
 */
export async function handleRTCSignal(signal: RTCSignalPayload): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall || signal.roomId !== activeCall.roomId) return;

  const { getActivePeerConnection } = await import("@/lib/webrtc/peerConnection");
  const pc = getActivePeerConnection();

  switch (signal.type) {
    case "offer": {
      if (!pc || !signal.data?.offer) return;
      await setRemoteDescription(pc, signal.data.offer);
      const answer = await createAnswer(pc);
      await publishRTCSignal("answer", signal.roomId, signal.senderPubkey, {
        answer,
      });
      break;
    }
    case "answer": {
      if (!pc || !signal.data?.answer) return;
      await setRemoteDescription(pc, signal.data.answer);
      store.dispatch(setCallState("active"));
      break;
    }
    case "candidate": {
      if (!pc || !signal.data?.candidates) return;
      for (const candidate of signal.data.candidates) {
        await addIceCandidate(pc, candidate);
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
 * Handle P2P connection failure — fall back to SFU.
 */
async function handleP2PFailure(
  partnerPubkey: string,
  roomId: string,
): Promise<void> {
  console.log("[call] P2P failed, falling back to SFU");

  closePeerConnection();

  try {
    const { token, url } = await fetchDMVoiceToken(partnerPubkey, roomId);
    await connectToRoom(url, token);
    store.dispatch(setSfuFallback(true));
    store.dispatch(setCallState("active"));
  } catch (err) {
    console.error("[call] SFU fallback failed:", err);
    store.dispatch(endCall("failed"));
  }
}

/**
 * Send a call status notification via gift wrap.
 */
async function sendCallStatus(
  partnerPubkey: string,
  type: "call_decline" | "call_missed",
): Promise<void> {
  try {
    const wrap = await createGiftWrappedDM("", partnerPubkey, [["type", type]]);
    const relays = await getDMRelaysForPublish(partnerPubkey);
    relayManager.publish(wrap, relays);
  } catch (err) {
    console.warn(`[call] Failed to send ${type}:`, err);
  }
}

/**
 * Get the local media stream for UI rendering.
 */
export function getLocalStream(): MediaStream | null {
  return localStream;
}

/**
 * Get the remote media stream for UI rendering.
 */
export function getRemoteStream(): MediaStream | null {
  return remoteStream;
}
