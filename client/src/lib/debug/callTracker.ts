/**
 * Voice/video call diagnostics.
 *
 *     wiredDebug.calls()           // snapshot: call state, LiveKit room,
 *                                  // publications, remote-audio registry
 *     wiredDebug.enable("call")    // live trace of room/track events
 *
 * The snapshot is the tool for "the call is flaky": it shows WHICH leg is
 * broken — the room (not connected / reconnecting), publications (partner
 * never published, track muted), playback (autoplay blocked, nothing
 * attached), or media capture (mediaError) — without reading a live event
 * stream. All 1:1 calls and voice channels are LiveKit rooms.
 *
 * For "audio glitches / cuts out", the audio-health tables answer network
 * vs device: loss, jitter and concealment per received track, what our own
 * mic is sending and what the far end reports back, and whether media runs
 * over UDP, TCP or a TURN relay (TCP and relayed paths stutter under loss).
 * Run it twice a few seconds apart; the counters are cumulative.
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

type StatRow = Record<string, unknown>;
type Stat = Record<string, unknown> & { type?: string; id?: string };
type StatsSource = { getRTCStatsReport?: () => Promise<RTCStatsReport | undefined> };

const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const pct = (part: number | undefined, whole: number | undefined): string =>
  part !== undefined && whole ? `${((part / whole) * 100).toFixed(1)}%` : "?";
const ms = (seconds: number | undefined): string =>
  seconds !== undefined ? `${Math.round(seconds * 1000)} ms` : "?";

async function statsOf(track: unknown): Promise<Stat[]> {
  const out: Stat[] = [];
  try {
    const report = await (track as StatsSource | null)?.getRTCStatsReport?.();
    report?.forEach((s: Stat) => out.push(s));
  } catch {
    // Stats are best effort (the track can be mid-teardown).
  }
  return out;
}

/** The ICE path media actually runs on: UDP / TCP, direct or TURN-relayed. */
function transportOf(stats: Stat[]): string {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const transport = stats.find((s) => s.type === "transport");
  const pair =
    (transport && byId.get(transport.selectedCandidatePairId as string)) ??
    stats.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");
  if (!pair) return "?";
  const local = byId.get(pair.localCandidateId as string);
  const kind = local?.candidateType === "relay" ? `relay/${local.relayProtocol ?? "?"}` : local?.candidateType;
  return `${local?.protocol ?? "?"} ${kind ?? "?"} rtt=${ms(num(pair.currentRoundTripTime))}`;
}

/** Receive-side health of one remote audio track. */
function inboundRow(participant: string, stats: Stat[]): StatRow | null {
  const rtp = stats.find((s) => s.type === "inbound-rtp");
  if (!rtp) return null;
  const received = num(rtp.packetsReceived);
  const lost = num(rtp.packetsLost);
  const emitted = num(rtp.jitterBufferEmittedCount);
  const delay = num(rtp.jitterBufferDelay);
  return {
    participant,
    lost: `${lost ?? "?"} (${pct(lost, (received ?? 0) + (lost ?? 0))})`,
    jitter: ms(num(rtp.jitter)),
    // Samples the decoder had to invent: what a listener hears as glitches.
    concealed: pct(num(rtp.concealedSamples), num(rtp.totalSamplesReceived)),
    concealmentEvents: rtp.concealmentEvents ?? "?",
    jitterBuffer: emitted && delay !== undefined ? ms(delay / emitted) : "?",
    transport: transportOf(stats),
  };
}

/** What our mic sends, and what the SFU reports receiving from it. */
function outboundRow(track: { mediaStreamTrack?: MediaStreamTrack }, stats: Stat[]): StatRow {
  const out = stats.find((s) => s.type === "outbound-rtp");
  const remote = stats.find((s) => s.type === "remote-inbound-rtp");
  const mst = track.mediaStreamTrack;
  const settings = mst?.getSettings?.() ?? {};
  return {
    capture: mst ? `${mst.readyState}${mst.muted ? " (OS-muted)" : ""}${mst.enabled ? "" : " (disabled)"}` : "?",
    sampleRate: settings.sampleRate ?? "?",
    echoCancellation: settings.echoCancellation ?? "?",
    noiseSuppression: settings.noiseSuppression ?? "?",
    autoGainControl: settings.autoGainControl ?? "?",
    voiceIsolation: (settings as { voiceIsolation?: boolean }).voiceIsolation ?? "?",
    packetsSent: out?.packetsSent ?? "?",
    lostAtServer: remote?.fractionLost !== undefined ? pct(num(remote.fractionLost), 1) : "?",
    serverJitter: ms(num(remote?.jitter)),
    rtt: ms(num(remote?.roundTripTime)),
    transport: transportOf(stats),
  };
}

async function report(): Promise<void> {
  const [{ store }, { getLivekitRoom }, remoteAudio, { getMediaPrefs }] = await Promise.all([
    import("../../store"),
    import("../webrtc/livekitClient"),
    import("../webrtc/remoteAudio"),
    import("../webrtc/mediaPrefs"),
  ]);

  const state = store.getState();
  const { activeCall, incomingCall, panelMode } = state.call;
  const voice = state.voice;

  // ── Redux call/voice state ────────────────────────────────────────────
  print("[wiredDebug.calls] call state:", activeCall
    ? {
        state: activeCall.state,
        type: activeCall.callType,
        direction: activeCall.direction,
        partner: shortKey(activeCall.partnerPubkey),
        room: `dm:${activeCall.roomId.slice(0, 8)}`,
        panel: panelMode,
        muted: activeCall.isMuted,
        video: activeCall.isVideoEnabled,
        screen: activeCall.isScreenSharing,
        ringingSec: Math.round(((activeCall.connectedAt ?? Date.now()) - activeCall.startedAt) / 1000),
        activeSec: activeCall.connectedAt
          ? Math.round((Date.now() - activeCall.connectedAt) / 1000)
          : 0,
      }
    : "(no active call)");
  if (incomingCall) {
    print("  incoming:", {
      from: shortKey(incomingCall.callerPubkey),
      type: incomingCall.callType,
      transport: incomingCall.transport ?? "legacy",
      ageSec: Math.round((Date.now() - incomingCall.timestamp) / 1000),
    });
  }
  print("  voice localState:", {
    ...voice.localState,
    room: voice.connectedRoom
      ? `${voice.connectedRoom.spaceId.slice(0, 8)}/${voice.connectedRoom.channelId}`
      : null,
    connection: voice.connectionState,
    audioPlaybackBlocked: voice.audioPlaybackBlocked,
    mediaError: voice.mediaError,
    layout: voice.layout.mode,
  });
  print("  media prefs:", getMediaPrefs());

  // ── LiveKit room ──────────────────────────────────────────────────────
  const room = getLivekitRoom();
  if (room) {
    print("  LiveKit room:", {
      state: room.state,
      canPlaybackAudio: room.canPlaybackAudio,
      localIdentity: shortKey(room.localParticipant.identity),
      micEnabled: room.localParticipant.isMicrophoneEnabled,
      camEnabled: room.localParticipant.isCameraEnabled,
      screenEnabled: room.localParticipant.isScreenShareEnabled,
      activeMic: room.getActiveDevice("audioinput"),
      activeCam: room.getActiveDevice("videoinput"),
      activeOut: room.getActiveDevice("audiooutput"),
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

    // ── Audio health ────────────────────────────────────────────────────
    const inbound: StatRow[] = [];
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (!pub.track) continue;
        const row = inboundRow(shortKey(p.identity), await statsOf(pub.track));
        if (row) inbound.push(row);
      }
    }
    if (inbound.length > 0) {
      print("  received audio (cumulative):");
      printTable(inbound);
    }
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      if (!pub.track || pub.source !== "microphone") continue;
      print("  our microphone:", outboundRow(pub.track, await statsOf(pub.track)));
    }
  } else {
    print("  LiveKit room: (none)");
  }

  print(
    `  remoteAudio registry: ${remoteAudio.attachedRemoteAudioCount()} attached, outputMuted=${remoteAudio.isRemoteAudioOutputMuted()}`,
  );
  // A paused element with a subscribed, unmuted track = that person is silent.
  const elements = remoteAudio.remoteAudioDiagnostics();
  if (elements.length > 0) printTable(elements);
}

registerDebugCommand("calls", () => void report());
