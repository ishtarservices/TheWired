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
  } else {
    print("  LiveKit room: (none)");
  }

  print(
    `  remoteAudio registry: ${remoteAudio.attachedRemoteAudioCount()} attached, outputMuted=${remoteAudio.isRemoteAudioOutputMuted()}`,
  );
}

registerDebugCommand("calls", () => void report());
