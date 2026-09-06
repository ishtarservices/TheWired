import {
  Room,
  RoomEvent,
  Track,
  ConnectionQuality,
  VideoPresets,
  ScreenSharePresets,
  DisconnectReason,
  type RoomOptions,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type TrackPublication,
  type Participant,
  type LocalAudioTrack,
} from "livekit-client";
import {
  getMediaPrefs,
  subscribeMediaPrefs,
  audioProcessingChanged,
  type MediaPrefs,
} from "./mediaPrefs";
import { supportsAudioOutputSelection, isWindows } from "../platform";
import type { TileSource } from "@/types/calling";
import { store } from "@/store";
import {
  addParticipant,
  removeParticipant,
  updateParticipant,
  setActiveSpeakers,
  setConnectionQuality,
  setAudioPlaybackBlocked,
  setVoiceConnectionState,
  setMediaError,
  disconnectRoom,
} from "@/store/slices/voiceSlice";
import {
  attachRemoteAudio,
  detachRemoteAudio,
  clearRemoteAudio,
} from "./remoteAudio";
import { describeMediaError } from "./mediaDevices";
import { playJoinSound, playLeaveSound } from "@/features/calling/callRingtone";
import { createLogger, shortKey } from "../debug/logger";

const log = createLogger("call");
import {
  LISTEN_TOGETHER_TOPIC,
  decodeLTMessage,
} from "@/features/listenTogether/syncProtocol";
import {
  handleIncomingMessage,
  broadcastSessionToLateJoiner,
  cleanupListenTogether,
} from "@/features/listenTogether/listenTogetherService";
import { removeListener } from "@/store/slices/listenTogetherSlice";

/** Singleton LiveKit Room instance */
let currentRoom: Room | null = null;

/**
 * Coarse room lifecycle hooks for feature code that must react to the
 * shared room (the 1:1 call service watches for its partner joining /
 * leaving). Keeps callService out of this module's imports.
 */
export interface RoomListener {
  onParticipantConnected?(identity: string): void;
  onParticipantDisconnected?(identity: string): void;
  /** `clientInitiated` = our own disconnect() (hangup, room switch). */
  onDisconnected?(reason: DisconnectReason | undefined, clientInitiated: boolean): void;
}

const roomListeners = new Set<RoomListener>();

export function addRoomListener(listener: RoomListener): () => void {
  roomListeners.add(listener);
  return () => {
    roomListeners.delete(listener);
  };
}

/** Get the current LiveKit room (or null if not connected) */
export function getLivekitRoom(): Room | null {
  return currentRoom;
}

/** Whether `pubkey` is the local participant of the connected room. */
export function isLocalIdentity(pubkey: string): boolean {
  return currentRoom?.localParticipant.identity === pubkey;
}

/**
 * Room options shared by voice channels and 1:1 calls.
 *
 * Audio: LiveKit's defaults are tuned for music (48k + DTX). DTX stops
 * sending during "silence"; combined with noise suppression it clips soft
 * speech onsets and reads as the other person's voice fading in and out.
 * RED (redundant audio) stays on — it hides packet loss on lossy Wi-Fi.
 *
 * Video: 1080p H.264 capture with 720p/360p simulcast layers; adaptiveStream
 * (device-pixel aware) serves small tiles the small layers and the focused
 * or 1:1 tile the full one, so grid views stay cheap on server egress.
 *
 * Devices + processing flags come from `mediaPrefs` (Settings › Voice). A
 * bare deviceId string is an *ideal* constraint, so an unplugged remembered
 * device falls back to the system default instead of failing the join.
 */
export function buildRoomOptions(prefs: MediaPrefs = getMediaPrefs()): RoomOptions {
  return {
    // Subscribe to the simulcast layer that matches the tile in DEVICE
    // pixels. LiveKit's desktop default is density 1, so on a Retina Mac a
    // 420px-wide call panel pulled the 360p layer and upscaled it 2× — the
    // single biggest "calls look blurry" cause.
    adaptiveStream: { pixelDensity: "screen" },
    dynacast: true,
    videoCaptureDefaults: {
      deviceId: prefs.videoInput ?? undefined,
      // 1080p top layer for the focused / 1:1 tile (webcams without 1080p
      // fall back — the constraint is "ideal"); grid tiles pull 720/360.
      resolution: VideoPresets.h1080.resolution,
    },
    audioCaptureDefaults: {
      deviceId: prefs.audioInput ?? undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    },
    ...(prefs.audioOutput && supportsAudioOutputSelection
      ? { audioOutput: { deviceId: prefs.audioOutput } }
      : {}),
    publishDefaults: {
      dtx: false,
      red: true,
      audioPreset: { maxBitrate: 48_000 },
      // H.264 is hardware-encoded on both desktop WebViews (WKWebView,
      // WebView2) and cleaner per bit than VP8, which was the default.
      // LiveKit keeps a VP8 backup codec for peers that can't take it.
      videoCodec: "h264",
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
      // For a ≥1080p capture LiveKit would default to maintain-resolution
      // (drop frames under congestion); faces read better the other way.
      degradationPreference: "balanced",
      screenShareEncoding: screenShareEncoding(prefs),
    },
  };
}

/** Screen-share encoding: crisp text by default, or smooth motion on request. */
function screenShareEncoding(prefs: MediaPrefs) {
  return prefs.screenShareMotion
    ? ScreenSharePresets.h1080fps30.encoding
    : ScreenSharePresets.h1080fps15.encoding;
}

/**
 * Connect to a LiveKit room and wire up event handlers for Redux state sync.
 */
export async function connectToRoom(
  serverUrl: string,
  token: string,
): Promise<Room> {
  // Disconnect from any existing room
  if (currentRoom) {
    await currentRoom.disconnect();
    currentRoom = null;
  }

  const room = new Room(buildRoomOptions());

  /** Mirror a publication's muted flag into the participant record. LiveKit
   *  `setCameraEnabled(false)` MUTES the camera track (it does not unpublish),
   *  so a remote camera-off arrives here — without the Camera branch the tile
   *  keeps `hasVideo` and shows a frozen/black frame. */
  const applyPublicationMuted = (
    publication: TrackPublication,
    participant: Participant,
    muted: boolean,
  ) => {
    if (participant.identity === room.localParticipant.identity) return;
    switch (publication.source) {
      case Track.Source.Microphone:
        store.dispatch(updateParticipant({ pubkey: participant.identity, isMuted: muted }));
        break;
      case Track.Source.Camera:
        store.dispatch(updateParticipant({ pubkey: participant.identity, hasVideo: !muted }));
        break;
      case Track.Source.ScreenShare:
        store.dispatch(
          updateParticipant({ pubkey: participant.identity, isScreenSharing: !muted }),
        );
        break;
      default:
        break;
    }
  };

  // Wire up room events to Redux
  room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
    log.info(`participant joined ${shortKey(participant.identity)}`);
    store.dispatch(addParticipant(participantRecord(participant)));
    playJoinSound();
    for (const l of roomListeners) l.onParticipantConnected?.(participant.identity);
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    store.dispatch(removeParticipant(participant.identity));
    playLeaveSound();
    for (const l of roomListeners) l.onParticipantDisconnected?.(participant.identity);
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    store.dispatch(setActiveSpeakers(speakers.map((s) => s.identity)));
  });

  room.on(
    RoomEvent.ConnectionQualityChanged,
    (quality: ConnectionQuality, participant: Participant) => {
      if (participant.identity === room.localParticipant.identity) {
        store.dispatch(setConnectionQuality(mapConnectionQuality(quality)));
      } else {
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            connectionQuality: mapConnectionQuality(quality),
          }),
        );
      }
    },
  );

  room.on(RoomEvent.TrackMuted, (publication, participant) => {
    applyPublicationMuted(publication, participant, true);
  });

  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    applyPublicationMuted(publication, participant, false);
  });

  room.on(
    RoomEvent.TrackSubscribed,
    (track, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      // Audio (Microphone AND ScreenShareAudio) must be attached to an
      // element or it never plays — speaking indicators work without it,
      // which is exactly the "green rings but silence" bug (audit #7).
      log.info(
        `track subscribed src=${publication.source} kind=${track.kind} from=${shortKey(participant.identity)}`,
      );
      if (track.kind === Track.Kind.Audio) {
        attachRemoteAudio(track, participant.identity);
      }
      // A track published after join arrives as TrackSubscribed, not
      // TrackUnmuted — apply its current muted flag (a camera can subscribe
      // already muted; a late mic would otherwise show muted forever).
      applyPublicationMuted(publication, participant, publication.isMuted);
    },
  );

  room.on(
    RoomEvent.TrackUnsubscribed,
    (track, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      log.info(
        `track unsubscribed src=${publication.source} kind=${track.kind} from=${shortKey(participant.identity)}`,
      );
      if (track.kind === Track.Kind.Audio) {
        detachRemoteAudio(track);
      }
      applyPublicationMuted(publication, participant, true);
    },
  );

  // Transport state — LiveKit reconnects on its own after a network blip,
  // but without these the UI just freezes silently for the duration.
  room.on(RoomEvent.Reconnecting, () => {
    log.warn("reconnecting (media)");
    store.dispatch(setVoiceConnectionState("reconnecting"));
  });
  room.on(RoomEvent.SignalReconnecting, () => {
    log.warn("reconnecting (signal)");
    store.dispatch(setVoiceConnectionState("reconnecting"));
  });
  room.on(RoomEvent.Reconnected, () => {
    log.info("reconnected");
    store.dispatch(setVoiceConnectionState("connected"));
  });

  // Autoplay policy (Tauri WKWebView / Windows WebView2): when playback is
  // blocked, surface a flag so the UI can offer an "Enable audio" action
  // that calls room.startAudio() from a user gesture.
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (room.canPlaybackAudio) {
      log.info("audio playback allowed");
    } else {
      // Always print — this IS the "connected but silent" symptom.
      log.warn("audio playback BLOCKED by autoplay policy — showing enable pill");
    }
    store.dispatch(setAudioPlaybackBlocked(!room.canPlaybackAudio));
  });

  room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    // Only log non-user-initiated disconnects — ordinary hangups are noise.
    if (reason !== undefined && reason !== DisconnectReason.CLIENT_INITIATED) {
      console.warn(`[LiveKit] disconnected: ${disconnectReasonName(reason)} (${reason})`);
    }
    cleanupListenTogether();
    clearRemoteAudio();
    store.dispatch(disconnectRoom());
    currentRoom = null;
    // The room singleton is shared between voice channels and 1:1 calls;
    // callService ends the call on a non-client drop via this hook.
    const clientInitiated = reason === DisconnectReason.CLIENT_INITIATED;
    for (const l of roomListeners) l.onDisconnected?.(reason, clientInitiated);
  });

  // Camera/mic acquisition failures (Windows: "device in use by another
  // app" is common) — surface them instead of only logging.
  room.on(RoomEvent.MediaDevicesError, (error) => {
    console.error(`[LiveKit] MediaDevicesError:`, error);
    store.dispatch(setMediaError(describeMediaError(error)));
  });

  // Listen Together: route data messages with the LT topic
  room.on(
    RoomEvent.DataReceived,
    (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== LISTEN_TOGETHER_TOPIC || !participant) return;

      const msg = decodeLTMessage(payload);
      if (msg) {
        handleIncomingMessage(msg, participant.identity);
      }
    },
  );

  // Listen Together: re-broadcast session state to late joiners (DJ only)
  room.on(RoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
    broadcastSessionToLateJoiner();
  });

  // Listen Together: cleanup listener list when participants leave
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    const lt = store.getState().listenTogether;
    if (lt.active) {
      store.dispatch(removeListener(participant.identity));
    }
  });

  // Connect
  log.info(`connecting to ${serverUrl}`);
  await room.connect(serverUrl, token);
  log.info(
    `room connected participants=${room.remoteParticipants.size} canPlaybackAudio=${room.canPlaybackAudio}`,
  );

  // Add existing participants
  for (const participant of room.remoteParticipants.values()) {
    // Tracks subscribed before our TrackSubscribed handler saw them
    // (autoSubscribe racing connect) still need their audio attached.
    for (const publication of participant.trackPublications.values()) {
      if (publication.track && publication.track.kind === Track.Kind.Audio) {
        attachRemoteAudio(publication.track, participant.identity);
      }
    }
    store.dispatch(addParticipant(participantRecord(participant)));
  }

  currentRoom = room;
  return room;
}

/** Snapshot a remote participant into the Redux record shape. */
function participantRecord(participant: RemoteParticipant) {
  return {
    pubkey: participant.identity,
    displayName: participant.name ?? participant.identity,
    isSpeaking: false,
    isMuted: !participant.isMicrophoneEnabled,
    isDeafened: false,
    hasVideo: participant.isCameraEnabled,
    isScreenSharing: participant.isScreenShareEnabled,
    connectionQuality: mapConnectionQuality(participant.connectionQuality),
    handRaised: false,
    audioLevel: 0,
  };
}

/**
 * Disconnect from the current LiveKit room.
 */
export async function disconnectFromRoom(): Promise<void> {
  if (currentRoom) {
    await currentRoom.disconnect();
    currentRoom = null;
  }
}

/**
 * Enable/disable the local microphone.
 */
export async function setMicrophoneEnabled(enabled: boolean): Promise<void> {
  if (!currentRoom) return;
  await currentRoom.localParticipant.setMicrophoneEnabled(enabled);
}

/**
 * Enable/disable the local camera.
 */
export async function setCameraEnabled(enabled: boolean): Promise<void> {
  if (!currentRoom) return;
  await currentRoom.localParticipant.setCameraEnabled(enabled);
}

/**
 * Start/stop screen sharing.
 *
 * Capture options (all are hints to the OS/WebView picker):
 *  - selfBrowserSurface "exclude": hide THIS window from the picker so the
 *    sharer can't pick the app and produce the hall-of-mirrors effect.
 *  - surfaceSwitching "include": Chromium's "share a different tab/window"
 *    control while sharing.
 *  - systemAudio: Windows (WebView2) can capture desktop audio; WKWebView
 *    cannot, so don't ask for it there.
 *  - contentHint "detail" + 1080p15: text stays legible; motion is rare.
 */
export async function setScreenShareEnabled(enabled: boolean): Promise<void> {
  if (!currentRoom) return;
  if (!enabled) {
    await currentRoom.localParticipant.setScreenShareEnabled(false);
    return;
  }
  const motion = getMediaPrefs().screenShareMotion;
  await currentRoom.localParticipant.setScreenShareEnabled(
    true,
    {
      audio: isWindows,
      systemAudio: isWindows ? "include" : "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      contentHint: motion ? "motion" : "detail",
      resolution: ScreenSharePresets.h1080fps15.resolution,
    },
    { screenShareEncoding: screenShareEncoding(getMediaPrefs()) },
  );
}

const TILE_SOURCE_MAP: Record<TileSource, Track.Source> = {
  camera: Track.Source.Camera,
  screenshare: Track.Source.ScreenShare,
};

/**
 * A participant's current track for a tile source, or null. UI code goes
 * through this (and `onTrackTopologyChanged`) instead of touching the Room
 * so `livekit-client` value imports stay confined to this module.
 */
export function getParticipantTrack(
  pubkey: string,
  source: TileSource,
  isLocal = false,
): Track | null {
  const room = currentRoom;
  if (!room) return null;
  const participant = isLocal ? room.localParticipant : room.remoteParticipants.get(pubkey);
  return participant?.getTrackPublication(TILE_SOURCE_MAP[source])?.track ?? null;
}

const TOPOLOGY_EVENTS = [
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
] as const;

/** Fires whenever any track is (un)published / (un)subscribed / (un)muted. */
export function onTrackTopologyChanged(cb: () => void): () => void {
  const room = currentRoom as unknown as {
    on(ev: string, fn: () => void): unknown;
    off(ev: string, fn: () => void): unknown;
  } | null;
  if (!room) return () => {};
  for (const ev of TOPOLOGY_EVENTS) room.on(ev, cb);
  return () => {
    for (const ev of TOPOLOGY_EVENTS) room.off(ev, cb);
  };
}

/**
 * The microphone track LiveKit is currently publishing, wrapped in a
 * MediaStream (for the input level meter). Null when not connected or the
 * mic is not published.
 */
export function getLocalMicrophoneStream(): MediaStream | null {
  const track = currentRoom?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  const mst = track?.mediaStreamTrack;
  return mst ? new MediaStream([mst]) : null;
}

/**
 * Switch a live device. `null` = back to the system default. Returns false
 * when nothing is connected. Errors surface as `voice.mediaError`.
 */
export async function switchMediaDevice(
  kind: MediaDeviceKind,
  deviceId: string | null,
): Promise<boolean> {
  if (!currentRoom) return false;
  if (kind === "audiooutput" && !supportsAudioOutputSelection) return false;
  try {
    await currentRoom.switchActiveDevice(kind, deviceId ?? "default");
    return true;
  } catch (err) {
    console.warn(`[LiveKit] switchActiveDevice(${kind}) failed:`, err);
    store.dispatch(
      setMediaError(describeMediaError(err, kind === "videoinput" ? "camera" : "microphone")),
    );
    return false;
  }
}

/** Re-capture the mic with new processing flags (echo/noise/gain). */
async function restartMicrophone(prefs: MediaPrefs): Promise<void> {
  const pub = currentRoom?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = pub?.track as LocalAudioTrack | undefined;
  if (!track || typeof track.restartTrack !== "function") return;
  try {
    await track.restartTrack({
      deviceId: prefs.audioInput ?? undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    });
  } catch (err) {
    console.warn("[LiveKit] restartTrack failed:", err);
    store.dispatch(setMediaError(describeMediaError(err, "microphone")));
  }
}

// Settings changes apply to the live room immediately — the user should not
// have to leave and rejoin to move to the headset they just plugged in.
subscribeMediaPrefs((next, prev) => {
  if (!currentRoom) return;
  void (async () => {
    if (next.audioInput !== prev.audioInput) await switchMediaDevice("audioinput", next.audioInput);
    if (next.videoInput !== prev.videoInput) await switchMediaDevice("videoinput", next.videoInput);
    if (next.audioOutput !== prev.audioOutput) {
      await switchMediaDevice("audiooutput", next.audioOutput);
    }
    if (audioProcessingChanged(prev, next)) await restartMicrophone(next);
  })();
});

/**
 * Decode LiveKit DisconnectReason enum number to a readable name.
 * Enum values (as of livekit-client 2.x):
 *   0 UNKNOWN_REASON  1 CLIENT_INITIATED  2 DUPLICATE_IDENTITY  3 SERVER_SHUTDOWN
 *   4 PARTICIPANT_REMOVED  5 ROOM_DELETED  6 STATE_MISMATCH  7 JOIN_FAILURE
 *   8 MIGRATION  9 SIGNAL_CLOSE  10 ROOM_CLOSED  11 USER_UNAVAILABLE  12 USER_REJECTED
 */
function disconnectReasonName(reason: DisconnectReason | undefined): string {
  if (reason === undefined) return "undefined";
  const name = DisconnectReason[reason as unknown as number];
  return typeof name === "string" ? name : "UNKNOWN";
}

/** Map LiveKit ConnectionQuality to our type */
function mapConnectionQuality(
  quality: ConnectionQuality,
): "excellent" | "good" | "poor" | "unknown" {
  switch (quality) {
    case ConnectionQuality.Excellent:
      return "excellent";
    case ConnectionQuality.Good:
      return "good";
    case ConnectionQuality.Poor:
      return "poor";
    default:
      return "unknown";
  }
}
