/**
 * Voice/video call diagnostics.
 *
 *     wiredDebug.calls()           // full snapshot: call state, PC + ICE
 *                                  // stats, media tracks, LiveKit room,
 *                                  // remote-audio registry
 *     wiredDebug.enable("call")    // live trace of signaling/ICE/track events
 *
 * The snapshot is the tool for "the call is flaky": it shows WHICH leg is
 * broken — signaling (no offer/answer), ICE (no srflx/relay pair, high RTT),
 * media (track muted/ended), playback (autoplay blocked, nothing attached),
 * or LiveKit (not subscribed) — without reading a live event stream.
 *
 * Heavy imports are lazy (inside the command) to keep this module loadable
 * from main.tsx without dragging the call stack into the boot path.
 */
import { registerDebugCommand, shortKey } from "./logger";

/* eslint-disable no-console */

// Terser strips bare `console.info(...)` calls in prod builds (pure_funcs in
// vite.config). This snapshot is an on-demand console command and must work
// in production too — bound references survive the strip.
const print = console.info.bind(console);
const printTable = console.table.bind(console);

function trackRow(t: MediaStreamTrack) {
  return {
    kind: t.kind,
    label: t.label.slice(0, 30),
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState,
  };
}

/** Summarize the stats that explain flaky calls: the selected ICE pair and
 *  per-direction video quality. */
async function pcStatsSummary(pc: RTCPeerConnection) {
  const stats = await pc.getStats();
  const byId = new Map<string, Record<string, unknown>>();
  stats.forEach((r) => byId.set(r.id, r as unknown as Record<string, unknown>));

  let selectedPair: Record<string, unknown> | undefined;
  stats.forEach((r) => {
    if (r.type === "transport" && r.selectedCandidatePairId) {
      selectedPair = byId.get(r.selectedCandidatePairId as string);
    }
  });
  // Firefox path: no transport.selectedCandidatePairId
  if (!selectedPair) {
    stats.forEach((r) => {
      if (r.type === "candidate-pair" && (r.selected || r.state === "succeeded")) {
        selectedPair = r as unknown as Record<string, unknown>;
      }
    });
  }

  let pair: Record<string, unknown> | null = null;
  if (selectedPair) {
    const local = byId.get(selectedPair.localCandidateId as string);
    const remote = byId.get(selectedPair.remoteCandidateId as string);
    pair = {
      // host/srflx/relay — "host/host" failing across networks means STUN
      // never produced a usable pair (the #1 cause of flaky P2P)
      localType: local?.candidateType ?? "?",
      remoteType: remote?.candidateType ?? "?",
      state: selectedPair.state,
      rttMs: typeof selectedPair.currentRoundTripTime === "number"
        ? Math.round((selectedPair.currentRoundTripTime as number) * 1000)
        : "?",
      bytesSent: selectedPair.bytesSent,
      bytesReceived: selectedPair.bytesReceived,
    };
  }

  const video: Array<Record<string, unknown>> = [];
  stats.forEach((r) => {
    const rec = r as unknown as Record<string, unknown>;
    if (r.type === "inbound-rtp" && rec.kind === "video") {
      video.push({
        dir: "in",
        fps: rec.framesPerSecond ?? "?",
        size: `${rec.frameWidth ?? "?"}x${rec.frameHeight ?? "?"}`,
        packetsLost: rec.packetsLost,
        jitterMs: typeof rec.jitter === "number" ? Math.round((rec.jitter as number) * 1000) : "?",
        framesDropped: rec.framesDropped,
      });
    }
    if (r.type === "outbound-rtp" && rec.kind === "video") {
      video.push({
        dir: "out",
        fps: rec.framesPerSecond ?? "?",
        size: `${rec.frameWidth ?? "?"}x${rec.frameHeight ?? "?"}`,
        qualityLimitation: rec.qualityLimitationReason,
        retransmitted: rec.retransmittedPacketsSent,
      });
    }
  });

  return { pair, video };
}

async function report(): Promise<void> {
  const [
    { store },
    { getActivePeerConnection },
    callService,
    { getLivekitRoom },
    remoteAudio,
  ] = await Promise.all([
    import("../../store"),
    import("../webrtc/peerConnection"),
    import("../../features/calling/callService"),
    import("../webrtc/livekitClient"),
    import("../webrtc/remoteAudio"),
  ]);

  const state = store.getState();
  const { activeCall, incomingCall } = state.call;
  const voice = state.voice;

  // ── Redux call/voice state ────────────────────────────────────────────
  print("[wiredDebug.calls] call state:", activeCall
    ? {
        state: activeCall.state,
        type: activeCall.callType,
        direction: activeCall.direction,
        partner: shortKey(activeCall.partnerPubkey),
        room: activeCall.roomId.slice(0, 8),
        sfu: activeCall.isSfuFallback,
        muted: activeCall.isMuted,
        video: activeCall.isVideoEnabled,
        ageSec: Math.round((Date.now() - activeCall.startedAt) / 1000),
      }
    : "(no active call)");
  if (incomingCall) {
    print("  incoming:", {
      from: shortKey(incomingCall.callerPubkey),
      type: incomingCall.callType,
      ageSec: Math.round((Date.now() - incomingCall.timestamp) / 1000),
    });
  }
  print("  voice localState:", {
    ...voice.localState,
    room: voice.connectedRoom
      ? `${voice.connectedRoom.spaceId.slice(0, 8)}/${voice.connectedRoom.channelId}`
      : null,
    audioPlaybackBlocked: voice.audioPlaybackBlocked,
  });

  // ── P2P leg ───────────────────────────────────────────────────────────
  const pc = getActivePeerConnection();
  if (pc) {
    print("  P2P pc:", {
      signaling: pc.signalingState,
      ice: pc.iceConnectionState,
      gathering: pc.iceGatheringState,
      connection: pc.connectionState,
    });
    try {
      const { pair, video } = await pcStatsSummary(pc);
      print("  selected ICE pair:", pair ?? "(none — connection never succeeded)");
      if (video.length > 0) printTable(video);
    } catch (e) {
      print("  getStats failed:", e);
    }
  } else {
    print("  P2P pc: (none)");
  }

  const local = callService.getLocalStream();
  const remote = callService.getRemoteStream();
  if (local) {
    print("  local tracks:");
    printTable(local.getTracks().map(trackRow));
  }
  if (remote) {
    print("  remote tracks:");
    printTable(remote.getTracks().map(trackRow));
  }

  // ── LiveKit leg (voice channels + SFU calls) ──────────────────────────
  const room = getLivekitRoom();
  if (room) {
    print("  LiveKit room:", {
      state: room.state,
      canPlaybackAudio: room.canPlaybackAudio,
      localIdentity: shortKey(room.localParticipant.identity),
      micEnabled: room.localParticipant.isMicrophoneEnabled,
      camEnabled: room.localParticipant.isCameraEnabled,
    });
    const rows: Array<Record<string, unknown>> = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        rows.push({
          participant: shortKey(p.identity),
          source: pub.source,
          kind: pub.kind,
          subscribed: pub.isSubscribed,
          muted: pub.isMuted,
          hasTrack: !!pub.track,
        });
      }
      if (p.trackPublications.size === 0) {
        rows.push({ participant: shortKey(p.identity), source: "(no publications)" });
      }
    }
    if (rows.length > 0) printTable(rows);
    else print("  (no remote participants)");
  } else {
    print("  LiveKit room: (none)");
  }

  print(
    `  remoteAudio registry: ${remoteAudio.attachedRemoteAudioCount()} attached, outputMuted=${remoteAudio.isRemoteAudioOutputMuted()}`,
  );
}

registerDebugCommand("calls", () => void report());
