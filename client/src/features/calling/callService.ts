import { store } from "@/store";
import {
  startOutgoingCall,
  setCallState,
  setCallRoomId,
  endCall,
  setSfuFallback,
  rejectCall as rejectCallAction,
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
import { createLogger } from "@/lib/debug/logger";
import { fetchDMVoiceToken } from "@/lib/api/voice";
import {
  connectToRoom,
  disconnectFromRoom,
  setMicrophoneEnabled,
  setCameraEnabled,
  setScreenShareEnabled,
} from "@/lib/webrtc/livekitClient";
import type { CallType, RTCSignalPayload } from "@/types/calling";

// Gated "call" category (wiredDebug.enable("call")); warn/error always print.
const clog = createLogger("call");
const log = (msg: string, data?: unknown) => clog.info(msg, data);
const warn = (msg: string, data?: unknown) => clog.warn(msg, data);
const err = (msg: string, data?: unknown) => clog.error(msg, data);
const shortId = (id: string | undefined) => (id ? id.slice(0, 8) : "?");

/** "typ + address" summary from a raw SDP candidate line — the address shows
 *  whether host candidates are real IPs or mDNS ".local" names (the latter
 *  fail between apps without Local Network permission on macOS). */
const candidateSummary = (c: string) => {
  const m = /candidate:\S+ \d+ (\S+) \d+ (\S+) (\d+) typ (\w+)/i.exec(c);
  return m ? `${m[4]} ${m[2]}:${m[3]}/${m[1].toLowerCase()}` : c.slice(0, 48);
};

/** One-line track summary for getUserMedia results. */
const streamSummary = (s: MediaStream) =>
  s.getTracks().map((t) => `${t.kind}:${t.enabled ? "on" : "off"}${t.muted ? "(muted)" : ""}`).join(" ");

let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
/** ICE candidates that arrive before the PC has a remote description set. */
let pendingCandidates: RTCIceCandidateInit[] = [];
/** Grace timer for ICE "disconnected" — only fall back if it doesn't recover. */
let disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
/** Outgoing-call ring timeout — cleared on hangup/answer so a stale timer
 *  from call A can never tear down a later call B (#43). */
let ringTimer: ReturnType<typeof setTimeout> | null = null;
/** Per-call kind:25050 target relays (partner DM relays ∪ own DM relays). */
let signalRelaysCache: { partner: string; relays: string[] } | null = null;

/**
 * Relays for signaling events. Publishing to the full write-relay list gets
 * candidates dropped by rate limiters ("noting too much") and rejected by
 * relays that don't accept kind:25050 — route them like DMs instead.
 * Returns undefined (→ default write set) only if the DM lookup fails.
 */
async function getSignalRelays(partnerPubkey: string): Promise<string[] | undefined> {
  if (signalRelaysCache?.partner === partnerPubkey) return signalRelaysCache.relays;
  try {
    // No kind:10050 from the partner → undefined → default write set, since
    // only their full relay list is known to reach them.
    const partner = await getDMRelaysForPublish(partnerPubkey);
    if (!partner || partner.length === 0) return undefined;
    const relays = [...new Set([...partner, ...getOwnDMRelays()])];
    signalRelaysCache = { partner: partnerPubkey, relays };
    return relays;
  } catch {
    return undefined;
  }
}

/** Explicit constraints so the P2P path gets the same echo handling LiveKit
 *  capture already applies (first real audio playback enables echo). */
const CALL_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

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

  // Capture the roomId so the timeout can only ever end THIS call — the
  // state-only check let a stale timer from call A kill a later call B (#43).
  if (ringTimer) clearTimeout(ringTimer);
  const ringRoomId = roomId;
  ringTimer = setTimeout(() => {
    ringTimer = null;
    const state = store.getState().call;
    if (state.activeCall?.roomId === ringRoomId && state.activeCall.state === "ringing") {
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
    audio: CALL_AUDIO_CONSTRAINTS,
    video: callType === "video",
  });
  log(`local media acquired: ${streamSummary(localStream)}`);

  const signalRelays = await getSignalRelays(callerPubkey);

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      clog.debug(`ICE candidate → ${candidateSummary(candidate.candidate)}`);
      publishRTCSignal("candidate", roomId, callerPubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      }, signalRelays);
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

  await publishRTCSignal("connect", roomId, callerPubkey, undefined, signalRelays);
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
 * `notifyPeer: false` is used when the hangup IS the reaction to the peer's
 * own disconnect signal — publishing another disconnect would echo forever.
 */
export async function hangupCall(
  opts: { notifyPeer?: boolean } = {},
): Promise<void> {
  const { notifyPeer = true } = opts;
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  log(`hangup partner=${shortId(activeCall.partnerPubkey)} sfu=${activeCall.isSfuFallback}`);

  if (disconnectGraceTimer) {
    clearTimeout(disconnectGraceTimer);
    disconnectGraceTimer = null;
  }
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }

  if (notifyPeer) {
    // The partner's subscription filter ANDs #r with #p — a disconnect
    // published without the p-tag never reaches them (#6) and they keep
    // ringing/talking until timeout.
    await publishRTCSignal(
      "disconnect",
      activeCall.roomId,
      activeCall.partnerPubkey,
      undefined,
      await getSignalRelays(activeCall.partnerPubkey),
    ).catch(() => {});
  }
  signalRelaysCache = null;

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
  // #6 — the roomId + both pubkeys are plaintext on relay-visible kind:25050
  // events, so a passive observer could forge a `disconnect` (kill the call) or
  // race a forged `offer` (hijack the media). Require the signal to come from the
  // actual call partner for EVERY signal type.
  if (
    !activeCall ||
    signal.roomId !== activeCall.roomId ||
    signal.senderPubkey !== activeCall.partnerPubkey
  ) {
    clog.debug(
      `signal ← ${signal.type} DROPPED (${!activeCall ? "no active call" : signal.roomId !== activeCall.roomId ? "wrong room" : "non-partner sender"}) from=${shortId(signal.senderPubkey)}`,
    );
    return;
  }

  clog.debug(`signal ← ${signal.type} from=${shortId(signal.senderPubkey)}`);

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
      // Answer only the verified partner (== signal.senderPubkey after the guard).
      await publishRTCSignal(
        "answer",
        signal.roomId,
        activeCall.partnerPubkey,
        { answer },
        await getSignalRelays(activeCall.partnerPubkey),
      );
      log(`remote offer set, answer sent`);
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
      log(`remote answer set`);
      break;
    }
    case "candidate": {
      const pc = getActivePeerConnection();
      if (!signal.data?.candidates) return;
      for (const candidate of signal.data.candidates) {
        if (!pc || !pc.remoteDescription) {
          pendingCandidates.push(candidate);
          clog.debug(`ICE candidate ← ${candidateSummary(candidate.candidate ?? "")} buffered (${pendingCandidates.length} pending, no remoteDescription yet)`);
          continue;
        }
        clog.debug(`ICE candidate ← ${candidateSummary(candidate.candidate ?? "")}`);
        await addIceCandidate(pc, candidate).catch((e) =>
          warn(`addIceCandidate failed: ${(e as Error).message}`),
        );
      }
      break;
    }
    case "disconnect": {
      await hangupCall({ notifyPeer: false });
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
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  store.dispatch(setCallState("connecting"));

  localStream = await getUserMedia({
    audio: CALL_AUDIO_CONSTRAINTS,
    video: callType === "video",
  });
  log(`local media acquired: ${streamSummary(localStream)}`);

  const signalRelays = await getSignalRelays(calleePubkey);

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      clog.debug(`ICE candidate → ${candidateSummary(candidate.candidate)}`);
      publishRTCSignal("candidate", roomId, calleePubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      }, signalRelays);
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
  await publishRTCSignal("offer", roomId, calleePubkey, { offer }, signalRelays);
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
  log(`ICE state → ${state}`);
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
  if (buffered.length > 0) clog.debug(`flushing ${buffered.length} buffered ICE candidates`);
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
  releaseP2PStreams();

  try {
    const { token, url } = await fetchDMVoiceToken(partnerPubkey, roomId);
    await connectToRoom(url, token);
    // The call may have been hung up while we were connecting — don't leave
    // an orphaned LiveKit room behind.
    if (store.getState().call.activeCall?.roomId !== roomId) {
      log(`call ended during SFU fallback — disconnecting room`);
      await disconnectFromRoom();
      return;
    }
    await publishSfuLocalMedia();
    log(`SFU connected`);
    store.dispatch(setSfuFallback(true));
    store.dispatch(setCallState("active"));
  } catch (e) {
    // Only an error for a call that still exists — a hangup mid-fallback
    // aborts the connect and lands here too.
    if (store.getState().call.activeCall?.roomId === roomId) {
      err(`SFU fallback failed:`, e);
      store.dispatch(endCall("failed"));
    }
  }
}

/**
 * Stop and drop the P2P capture streams when switching to SFU — LiveKit does
 * its own capture, so keeping them leaks the camera/mic (LED stays on).
 */
function releaseP2PStreams(): void {
  if (localStream) {
    stopMediaStream(localStream);
    localStream = null;
  }
  remoteStream = null;
}

/**
 * Publish local media into the SFU room, honoring the current mute/video
 * flags. Without this the fallback room has no media in either direction.
 */
async function publishSfuLocalMedia(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;
  await setMicrophoneEnabled(!activeCall.isMuted);
  if (activeCall.callType === "video") {
    await setCameraEnabled(activeCall.isVideoEnabled);
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
  releaseP2PStreams();

  try {
    const { token, url } = await fetchDMVoiceToken(
      activeCall.partnerPubkey,
      activeCall.roomId,
    );
    await connectToRoom(url, token);
    if (store.getState().call.activeCall?.roomId !== activeCall.roomId) {
      await disconnectFromRoom();
      return;
    }
    await publishSfuLocalMedia();
    store.dispatch(setSfuFallback(true));
  } catch (e) {
    err(`SFU upgrade failed:`, e);
  }
}

/**
 * Apply mute to the actual transmitted audio. The Redux flag alone is
 * cosmetic — without this the partner keeps hearing you while the button
 * shows muted.
 */
export async function setCallMuted(muted: boolean): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  if (activeCall.isSfuFallback) {
    await setMicrophoneEnabled(!muted);
  } else {
    for (const track of localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }
}

/**
 * Apply camera on/off to the actual transmitted video. Privacy-critical:
 * the local PiP hides when "off", so the user can't tell the camera is
 * still streaming unless we actually disable the track.
 */
export async function setCallVideoEnabled(enabled: boolean): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  if (activeCall.isSfuFallback) {
    await setCameraEnabled(enabled);
  } else {
    for (const track of localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled;
    }
  }
}

/**
 * Screen share for 1:1 calls — SFU mode only. P2P would need renegotiation
 * (onnegotiationneeded is unwired), so the UI hides the button there.
 */
export async function setCallScreenShare(enabled: boolean): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall?.isSfuFallback) {
    throw new Error("Screen share requires SFU mode");
  }
  await setScreenShareEnabled(enabled);
}

export function getLocalStream(): MediaStream | null {
  return localStream;
}

export function getRemoteStream(): MediaStream | null {
  return remoteStream;
}
