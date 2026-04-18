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

/** Active media stream for the current call */
let localStream: MediaStream | null = null;
/** Remote media stream */
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

  log(`→ initiateCall partner=${shortId(partnerPubkey)} type=${callType} room=${shortId(roomId)}`);

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

  log(`  publishing invite: partnerRelays=${partnerRelays?.length ?? "default"} ownRelays=${ownRelays.length}`);
  relayManager.publish(recipientResult.wrap, partnerRelays);
  relayManager.publish(selfResult.wrap, ownRelays);

  setTimeout(() => {
    const state = store.getState().call;
    if (state.activeCall?.state === "ringing") {
      log(`  ringing timeout (30s) → missed`);
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

  log(`→ answerCall caller=${shortId(callerPubkey)} type=${callType} room=${shortId(roomId)}`);

  store.dispatch(setCallRoomId(roomId));
  store.dispatch(setCallState("connecting"));

  log(`  getUserMedia audio=true video=${callType === "video"}`);
  localStream = await getUserMedia({
    audio: true,
    video: callType === "video",
  });
  log(`  got local stream: ${localStream.getTracks().map((t) => t.kind).join(",")}`);

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      log(`  ← local ICE candidate ${describeCandidate(candidate.candidate)} → publish to caller`);
      publishRTCSignal("candidate", roomId, callerPubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      });
    },
    onIceConnectionStateChange: (state) => onIceStateChange(state, callerPubkey, roomId),
    onTrack: (event) => {
      log(`  ← remote track kind=${event.track.kind}`);
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
    },
    onNegotiationNeeded: () => log(`  onNegotiationNeeded (callee)`),
    onIceGatheringComplete: () => log(`  ICE gathering complete (callee)`),
  });

  addMediaTracks(pc, localStream);

  log(`  → publish "connect" signal to caller ${shortId(callerPubkey)}`);
  await publishRTCSignal("connect", roomId, callerPubkey);
}

/** Reject an incoming call. */
export async function rejectCall(): Promise<void> {
  const incomingCall = store.getState().call.incomingCall;
  if (!incomingCall) return;
  log(`→ rejectCall caller=${shortId(incomingCall.callerPubkey)}`);
  await sendCallStatus(incomingCall.callerPubkey, "call_decline");
}

/** Hang up the current call. */
export async function hangupCall(): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall) return;

  log(`→ hangupCall partner=${shortId(activeCall.partnerPubkey)} sfu=${activeCall.isSfuFallback}`);

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
  if (!activeCall || signal.roomId !== activeCall.roomId) {
    log(`  ignoring signal type=${signal.type} — no matching active call`);
    return;
  }

  log(`← signal type=${signal.type} from=${shortId(signal.senderPubkey)} room=${shortId(signal.roomId)}`);

  switch (signal.type) {
    case "connect": {
      if (activeCall.state !== "ringing" || getActivePeerConnection()) {
        log(`  ignoring connect — state=${activeCall.state} hasPc=${!!getActivePeerConnection()}`);
        return;
      }
      await startCallerPeerConnection(activeCall.partnerPubkey, signal.roomId, activeCall.callType);
      break;
    }
    case "offer": {
      const pc = getActivePeerConnection();
      if (!pc || !signal.data?.offer) {
        warn(`  got offer but pc=${!!pc} offer=${!!signal.data?.offer}`);
        return;
      }
      await setRemoteDescription(pc, signal.data.offer);
      log(`  set remote description (offer), flushing ${pendingCandidates.length} buffered candidates`);
      await flushPendingCandidates(pc);
      const answer = await createAnswer(pc);
      log(`  → publish "answer"`);
      await publishRTCSignal("answer", signal.roomId, signal.senderPubkey, { answer });
      break;
    }
    case "answer": {
      const pc = getActivePeerConnection();
      if (!pc || !signal.data?.answer) {
        warn(`  got answer but pc=${!!pc} answer=${!!signal.data?.answer}`);
        return;
      }
      await setRemoteDescription(pc, signal.data.answer);
      log(`  set remote description (answer), flushing ${pendingCandidates.length} buffered candidates`);
      await flushPendingCandidates(pc);
      break;
    }
    case "candidate": {
      const pc = getActivePeerConnection();
      if (!signal.data?.candidates) return;
      for (const candidate of signal.data.candidates) {
        if (!pc || !pc.remoteDescription) {
          log(`  buffering remote ICE candidate ${describeCandidate(candidate.candidate)} (pc=${!!pc}, remoteDesc=${!!pc?.remoteDescription})`);
          pendingCandidates.push(candidate);
          continue;
        }
        log(`  adding remote ICE candidate ${describeCandidate(candidate.candidate)}`);
        await addIceCandidate(pc, candidate).catch((e) =>
          warn(`  addIceCandidate failed: ${(e as Error).message}`),
        );
      }
      break;
    }
    case "disconnect": {
      log(`  partner sent disconnect → hangup`);
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
  log(`→ startCallerPeerConnection callee=${shortId(calleePubkey)} type=${callType}`);
  store.dispatch(setCallState("connecting"));

  log(`  getUserMedia audio=true video=${callType === "video"}`);
  localStream = await getUserMedia({
    audio: true,
    video: callType === "video",
  });
  log(`  got local stream: ${localStream.getTracks().map((t) => t.kind).join(",")}`);

  const pc = createPeerConnection({
    onIceCandidate: (candidate) => {
      log(`  ← local ICE candidate ${describeCandidate(candidate.candidate)} → publish to callee`);
      publishRTCSignal("candidate", roomId, calleePubkey, {
        candidates: [{ candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? undefined }],
      });
    },
    onIceConnectionStateChange: (state) => onIceStateChange(state, calleePubkey, roomId),
    onTrack: (event) => {
      log(`  ← remote track kind=${event.track.kind}`);
      if (!remoteStream) remoteStream = new MediaStream();
      remoteStream.addTrack(event.track);
    },
    onNegotiationNeeded: () => log(`  onNegotiationNeeded (caller)`),
    onIceGatheringComplete: () => log(`  ICE gathering complete (caller)`),
  });

  addMediaTracks(pc, localStream);

  const offer = await createOffer(pc);
  log(`  → publish "offer"`);
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
  log(`  ICE state → ${state}`);

  if (state === "connected" || state === "completed") {
    if (disconnectGraceTimer) {
      clearTimeout(disconnectGraceTimer);
      disconnectGraceTimer = null;
      log(`  ICE recovered — cancelling fallback grace timer`);
    }
    const pc = getActivePeerConnection();
    if (pc) void logIceStats(pc, "connected");
    store.dispatch(setCallState("active"));
    return;
  }

  if (state === "failed") {
    log(`  ICE failed → SFU fallback`);
    const pc = getActivePeerConnection();
    if (pc) void logIceStats(pc, "failed");
    handleP2PFailure(partnerPubkey, roomId);
    return;
  }

  if (state === "disconnected") {
    if (disconnectGraceTimer) return;
    log(`  ICE disconnected — waiting 5s for recovery before fallback`);
    disconnectGraceTimer = setTimeout(() => {
      disconnectGraceTimer = null;
      const pc = getActivePeerConnection();
      if (!pc) return;
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        log(`  ICE recovered during grace period`);
        return;
      }
      log(`  ICE still ${pc.iceConnectionState} after grace → SFU fallback`);
      handleP2PFailure(partnerPubkey, roomId);
    }, 5000);
  }
}

async function flushPendingCandidates(pc: RTCPeerConnection): Promise<void> {
  const buffered = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of buffered) {
    await addIceCandidate(pc, candidate).catch((e) =>
      warn(`  flushPendingCandidates: addIceCandidate failed: ${(e as Error).message}`),
    );
  }
}

function extractCandidateType(candidate: string | undefined): string {
  if (!candidate) return "?";
  const match = /typ (\w+)/.exec(candidate);
  return match ? match[1] : "?";
}

/**
 * Parse candidate-attribute string for key fields:
 *   "candidate:1 1 UDP 2122 192.168.1.10 54321 typ host ..."
 *              -> "host udp 192.168.1.10:54321"
 *   "candidate:2 1 UDP 2122 abc.local 54321 typ host ..."  (mDNS — not resolvable off-host)
 */
function describeCandidate(candidate: string | undefined): string {
  if (!candidate) return "?";
  const parts = candidate.split(" ");
  const proto = parts[2]?.toLowerCase() ?? "?";
  const addr = parts[4] ?? "?";
  const port = parts[5] ?? "?";
  const type = extractCandidateType(candidate);
  const isMdns = addr.endsWith(".local");
  return `${type} ${proto} ${addr}:${port}${isMdns ? " (mDNS)" : ""}`;
}

/** Dump the active ICE candidate pair via getStats so we can see which one was selected (or why none was). */
async function logIceStats(pc: RTCPeerConnection, tag: string): Promise<void> {
  try {
    const stats = await pc.getStats();
    const pairs: Array<Record<string, unknown>> = [];
    const candidates: Record<string, Record<string, unknown>> = {};
    stats.forEach((report) => {
      if (report.type === "candidate-pair") pairs.push(report as unknown as Record<string, unknown>);
      if (report.type === "local-candidate" || report.type === "remote-candidate") {
        candidates[(report as unknown as { id: string }).id] = report as unknown as Record<string, unknown>;
      }
    });
    const describePair = (p: Record<string, unknown>) => {
      const local = candidates[p.localCandidateId as string];
      const remote = candidates[p.remoteCandidateId as string];
      const fmt = (c: Record<string, unknown> | undefined) =>
        c ? `${c.candidateType}/${c.protocol} ${c.address ?? c.ip}:${c.port}` : "?";
      return `${fmt(local)} → ${fmt(remote)}  state=${p.state} nominated=${p.nominated} sent=${p.requestsSent}/${p.responsesReceived}`;
    };
    log(`[ice-stats:${tag}] pairs:`);
    for (const p of pairs) log(`    ${describePair(p)}`);
  } catch (e) {
    warn(`  getStats failed: ${(e as Error).message}`);
  }
}

/** Handle P2P connection failure — fall back to SFU. */
async function handleP2PFailure(
  partnerPubkey: string,
  roomId: string,
): Promise<void> {
  const activeCall = store.getState().call.activeCall;
  if (!activeCall || activeCall.isSfuFallback) return; // already fallen back

  log(`↷ P2P failed, falling back to SFU (room=${shortId(roomId)})`);

  closePeerConnection();
  pendingCandidates = [];

  try {
    log(`  fetchDMVoiceToken partner=${shortId(partnerPubkey)}`);
    const { token, url, roomName } = await fetchDMVoiceToken(partnerPubkey, roomId);
    log(`  SFU token ok, connecting to ${url} room=${roomName}`);
    await connectToRoom(url, token);
    log(`  SFU connected`);
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
    log(`  → ${type} to ${shortId(partnerPubkey)} via ${relays?.length ?? "default"} relays`);
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

  log(`↑ upgradeToSfuForListenTogether`);
  closePeerConnection();
  pendingCandidates = [];

  try {
    const { token, url, roomName } = await fetchDMVoiceToken(
      activeCall.partnerPubkey,
      activeCall.roomId,
    );
    log(`  SFU connecting to ${url} room=${roomName}`);
    await connectToRoom(url, token);
    store.dispatch(setSfuFallback(true));
  } catch (e) {
    err(`SFU upgrade for Listen Together failed:`, e);
  }
}

/** Get the local media stream for UI rendering. */
export function getLocalStream(): MediaStream | null {
  return localStream;
}

/** Get the remote media stream for UI rendering. */
export function getRemoteStream(): MediaStream | null {
  return remoteStream;
}
