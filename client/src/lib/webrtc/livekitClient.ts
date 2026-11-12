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
  Encryption_Type,
} from "livekit-client";
import {
  getMediaPrefs,
  subscribeMediaPrefs,
  audioProcessingChanged,
  audioProcessingConstraints,
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
  setE2EEActive,
  setE2EEError,
  setMuted,
  setVideoEnabled,
  setScreenSharing,
} from "@/store/slices/voiceSlice";
import { syncCallMedia } from "@/store/slices/callSlice";
import {
  attachRemoteAudio,
  detachRemoteAudio,
  clearRemoteAudio,
  resumeRemoteAudio,
  setRemoteAudioBlockedHandler,
} from "./remoteAudio";
import { describeMediaError } from "./mediaDevices";
import { playJoinSound, playLeaveSound } from "@/features/calling/callRingtone";
import { createLogger, shortKey } from "../debug/logger";
import { createE2EESession, type E2EEContext, type E2EESession } from "./e2ee/session";
import {
  assertMediaEpoch,
  isMediaEpochCurrent,
  mediaEpoch,
  MediaSessionAbortedError,
  onAbandonMediaSessions,
} from "./mediaSession";

const log = createLogger("call");
const e2eeLog = createLogger("e2ee");
import {
  LISTEN_TOGETHER_TOPIC,
  decodeLTMessage,
} from "@/features/listenTogether/syncProtocol";
import {
  handleIncomingMessage,
  broadcastSessionToLateJoiner,
  cleanupListenTogether,
  announceListenTogetherExit,
  handleParticipantLeft,
} from "@/features/listenTogether/listenTogetherService";

/** Singleton LiveKit Room instance */
let currentRoom: Room | null = null;
/** The room the most recent `connectToRoom` built, connected or still
 *  connecting. Only this room's `Disconnected` may reset Redux and notify
 *  listeners. A superseded room disconnecting late must not tear down the
 *  session that replaced it. */
let latestRoom: Room | null = null;
/** The E2EE session (worker + key provider) of the current room, if any. */
let currentE2EE: E2EESession | null = null;

/** Late joiners get the DJ's Listen Together state only after their key
 *  envelope has had time to land, or the encrypted packet is undecryptable. */
const LT_LATE_JOINER_KEY_SETTLE_MS = 1500;
/** One EncryptionError per participant per this window; frames fail per
 *  packet while a key is in flight and would otherwise flood. */
const ENCRYPTION_ERROR_DEBOUNCE_MS = 5000;
/** Channels only: decrypt failures inside this window after a participant
 *  joins are the expected key-in-flight race (their kind-20016 envelope is
 *  still crossing the relay), not an error worth a banner. 1:1 calls have
 *  both keys installed before connect, so there every failure is real — and
 *  the SDK throttles its error events per minute, so a grace there would
 *  hide a permanently wrong key for the whole first minute. */
const ENCRYPTION_ERROR_JOIN_GRACE_MS = 8000;

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
  /** A REMOTE participant's tracks are (not) end-to-end encrypted. `false`
   *  in an encrypted room means their client doesn't encrypt (outdated). */
  onParticipantEncryption?(identity: string, encrypted: boolean): void;
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

/** The current room's E2EE session (null = not connected or plaintext). */
export function getE2EESession(): E2EESession | null {
  return currentE2EE;
}

function disposeE2EE(session: E2EESession | null): void {
  if (!session) return;
  session.dispose();
  if (currentE2EE === session) currentE2EE = null;
}

/**
 * Room options shared by voice channels and 1:1 calls.
 *
 * Audio: LiveKit's defaults are tuned for music (48k + DTX). DTX stops
 * sending during "silence"; combined with noise suppression it clips soft
 * speech onsets and reads as the other person's voice fading in and out.
 * RED (redundant audio) stays on — it hides packet loss on lossy Wi-Fi —
 * except under frame-level E2EE, where LiveKit's own reference app turns it
 * off (the cryptor works per Opus frame; RED's redundant copies don't fit).
 *
 * Video: 1080p H.264 capture with 720p/360p simulcast layers; adaptiveStream
 * (device-pixel aware) serves small tiles the small layers and the focused
 * or 1:1 tile the full one, so grid views stay cheap on server egress.
 *
 * Devices + processing flags come from `mediaPrefs` (Settings › Voice). A
 * bare deviceId string is an *ideal* constraint, so an unplugged remembered
 * device falls back to the system default instead of failing the join.
 */
export function buildRoomOptions(
  prefs: MediaPrefs = getMediaPrefs(),
  opts: { e2ee?: boolean } = {},
): RoomOptions {
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
      ...audioProcessingConstraints(prefs),
    },
    ...(prefs.audioOutput && supportsAudioOutputSelection
      ? { audioOutput: { deviceId: prefs.audioOutput } }
      : {}),
    publishDefaults: {
      dtx: false,
      red: !opts.e2ee,
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

export interface ConnectOptions {
  /** Frame-level E2EE for this room. Required for every call and channel this
   *  build joins; the option exists so the wiring stays explicit. Throws
   *  `E2EEUnsupportedError` before any Room is built when the WebView can't. */
  e2ee?: E2EEContext;
  /** `mediaEpoch()` captured when the join began (before the token fetch).
   *  If the account changes before the room is up, the room is torn down and
   *  `MediaSessionAbortedError` is thrown: a token minted for the old account
   *  must never become a live session under the new one. Defaults to now. */
  epoch?: number;
}

/**
 * Connect to a LiveKit room and wire up event handlers for Redux state sync.
 *
 * E2EE ordering is load-bearing: the session (worker + key provider) must
 * exist at `new Room()`, `setE2EEEnabled(true)` and the pre-known keys must
 * precede `connect()` (the encryption type travels in the first publish
 * request), and the session starts (channels: key fan-out) once the roster
 * is known after connect.
 */
export async function connectToRoom(
  serverUrl: string,
  token: string,
  opts: ConnectOptions = {},
): Promise<Room> {
  const epoch = opts.epoch ?? mediaEpoch();
  // The token was minted for the account that started the join. If that
  // account is gone, don't build a room at all.
  assertMediaEpoch(epoch);

  // Disconnect from any existing room
  if (currentRoom) {
    await currentRoom.disconnect();
    currentRoom = null;
  }
  disposeE2EE(currentE2EE);

  const myPubkey = store.getState().identity.pubkey ?? "";
  /** Whose media the decrypt-error banner on screen is about (null = none,
   *  or our own encoder). Lets a late key clear exactly its own banner. */
  let decryptErrorFrom: string | null = null;
  const lastEncryptionErrorAt = new Map<string, number>();
  const e2ee = opts.e2ee
    ? createE2EESession(opts.e2ee, myPubkey, {
        // The key that was "still on its way" has landed: the banner saying
        // so is now wrong, and would otherwise sit there until dismissed.
        onRemoteKeyInstalled(sender) {
          lastEncryptionErrorAt.delete(sender);
          if (decryptErrorFrom !== sender) return;
          decryptErrorFrom = null;
          store.dispatch(setE2EEError(null));
        },
      })
    : null;
  currentE2EE = e2ee;

  const room = new Room({
    ...buildRoomOptions(getMediaPrefs(), { e2ee: !!e2ee }),
    ...(e2ee ? { encryption: { keyProvider: e2ee.provider, worker: e2ee.worker } } : {}),
  });
  latestRoom = room;
  /** When each remote joined — decrypt errors right after are key-in-flight. */
  const joinedAt = new Map<string, number>();

  /**
   * Keep our own mute / camera / share flags in step with what LiveKit is
   * really publishing. The controls flip Redux first and then drive the SDK,
   * so for a user toggle this finds nothing to change. It matters for the
   * changes that do not come from our controls: the SDK mutes a mic or camera
   * whose device went away and could not be replaced, a moderator mutes a
   * track server-side, the OS "stop sharing" button ends a screen share.
   * Before, the UI kept showing "unmuted" (or "sharing") while nothing was
   * being sent, and the user had to toggle twice to recover.
   */
  const syncLocalPublication = (publication: TrackPublication, live: boolean) => {
    const { call, voice } = store.getState();
    const activeCall = call.activeCall;
    const deviceEnded = publication.track?.mediaStreamTrack?.readyState === "ended";
    switch (publication.source) {
      case Track.Source.Microphone: {
        const muted = !live;
        if ((activeCall ? activeCall.isMuted : voice.localState.muted) === muted) return;
        log.warn(`local microphone ${muted ? "muted" : "unmuted"} outside the controls`);
        store.dispatch(activeCall ? syncCallMedia({ isMuted: muted }) : setMuted(muted));
        if (muted && deviceEnded) {
          store.dispatch(
            setMediaError(
              "Your microphone stopped working, so you are muted. Reconnect it or pick another input, then unmute.",
            ),
          );
        }
        break;
      }
      case Track.Source.Camera: {
        if ((activeCall ? activeCall.isVideoEnabled : voice.localState.videoEnabled) === live) return;
        log.warn(`local camera turned ${live ? "on" : "off"} outside the controls`);
        store.dispatch(activeCall ? syncCallMedia({ isVideoEnabled: live }) : setVideoEnabled(live));
        if (!live && deviceEnded) {
          store.dispatch(
            setMediaError(
              "Your camera stopped working, so it was turned off. Reconnect it or pick another camera, then turn it back on.",
            ),
          );
        }
        break;
      }
      case Track.Source.ScreenShare: {
        if ((activeCall ? activeCall.isScreenSharing : voice.localState.screenSharing) === live) return;
        store.dispatch(
          activeCall ? syncCallMedia({ isScreenSharing: live }) : setScreenSharing(live),
        );
        break;
      }
      default:
        break;
    }
  };

  /** Mirror a publication's muted flag into the participant record. LiveKit
   *  `setCameraEnabled(false)` MUTES the camera track (it does not unpublish),
   *  so a remote camera-off arrives here — without the Camera branch the tile
   *  keeps `hasVideo` and shows a frozen/black frame. */
  const applyPublicationMuted = (
    publication: TrackPublication,
    participant: Participant,
    muted: boolean,
  ) => {
    if (participant.identity === room.localParticipant.identity) {
      // Mic and camera only: a screen share is published / unpublished, never
      // muted, and is followed through LocalTrack(Un)Published below.
      if (publication.source !== Track.Source.ScreenShare) {
        syncLocalPublication(publication, !muted);
      }
      return;
    }
    switch (publication.source) {
      case Track.Source.Microphone:
        store.dispatch(updateParticipant({ pubkey: participant.identity, isMuted: muted }));
        break;
      case Track.Source.Camera:
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            hasVideo: !muted,
            // A camera that is off is not "paused"; a fresh one starts clean.
            ...(muted ? { videoPaused: false } : {}),
          }),
        );
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
    joinedAt.set(participant.identity, Date.now());
    store.dispatch(addParticipant(participantRecord(participant)));
    playJoinSound();
    for (const l of roomListeners) l.onParticipantConnected?.(participant.identity);

    // Listen Together: the DJ re-announces the session to the late joiner.
    // In an encrypted channel that packet is only decryptable once our key
    // envelope has reached them — hand the key over first, then announce.
    if (e2ee && e2ee.ctx.kind === "channel") {
      void e2ee
        .onParticipantJoined(participant.identity)
        .catch((err) => e2eeLog.warn(`key hand-over to ${shortKey(participant.identity)} failed`, err))
        .then(() => {
          setTimeout(() => {
            if (currentRoom === room) broadcastSessionToLateJoiner();
          }, LT_LATE_JOINER_KEY_SETTLE_MS);
        });
    } else {
      broadcastSessionToLateJoiner();
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    joinedAt.delete(participant.identity);
    lastEncryptionErrorAt.delete(participant.identity);
    e2ee?.onParticipantLeft(participant.identity);
    store.dispatch(removeParticipant(participant.identity));
    playLeaveSound();
    for (const l of roomListeners) l.onParticipantDisconnected?.(participant.identity);
  });

  // Frame-level E2EE status. LiveKit reports the local participant when our
  // encoder is (de)activated and every remote when one of their tracks is
  // subscribed, carrying whether that publication is encrypted.
  room.on(RoomEvent.ParticipantEncryptionStatusChanged, (encrypted: boolean, participant?: Participant) => {
    if (!participant || participant.identity === room.localParticipant.identity) {
      e2eeLog.info(`local encryption ${encrypted ? "on" : "off"}`);
      store.dispatch(setE2EEActive(encrypted));
      return;
    }
    e2eeLog.info(`${shortKey(participant.identity)} publishes ${encrypted ? "encrypted" : "PLAINTEXT"} tracks`);
    store.dispatch(updateParticipant({ pubkey: participant.identity, encrypted }));
    for (const l of roomListeners) l.onParticipantEncryption?.(participant.identity, encrypted);
  });

  const joinGraceMs = e2ee?.ctx.kind === "channel" ? ENCRYPTION_ERROR_JOIN_GRACE_MS : 0;
  room.on(RoomEvent.EncryptionError, (error: Error, participant?: Participant) => {
    const who = participant?.identity ?? "local";
    const now = Date.now();
    const joined = joinedAt.get(who);
    if (joined !== undefined && now - joined < joinGraceMs) return;
    const last = lastEncryptionErrorAt.get(who) ?? 0;
    if (now - last < ENCRYPTION_ERROR_DEBOUNCE_MS) return;
    lastEncryptionErrorAt.set(who, now);
    decryptErrorFrom = participant?.identity ?? null;
    e2eeLog.warn(`encryption error (${who === "local" ? "local" : shortKey(who)}): ${error.message}`);
    store.dispatch(
      setE2EEError(
        participant
          ? e2ee?.ctx.kind === "call"
            ? `Could not decrypt ${shortKey(participant.identity)}'s media — their app derives a different key (update needed).`
            : `Could not decrypt media from ${shortKey(participant.identity)} — their key may still be on its way.`
          : `Could not encrypt outgoing media: ${error.message}`,
      ),
    );
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

  // Our own screen share starting / ending. Ending is the case that matters:
  // the OS or browser "stop sharing" control ends the capture track and the
  // SDK unpublishes it without any of our controls being involved.
  room.on(RoomEvent.LocalTrackPublished, (publication: TrackPublication) => {
    if (publication.source === Track.Source.ScreenShare) syncLocalPublication(publication, true);
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication: TrackPublication) => {
    if (publication.source === Track.Source.ScreenShare) syncLocalPublication(publication, false);
  });

  // Tiles re-resolve their track on any of these (see onTrackTopologyChanged).
  for (const ev of TOPOLOGY_EVENTS) {
    (room as unknown as { on(ev: string, fn: () => void): unknown }).on(ev, notifyTopology);
  }

  // The SFU pauses a camera stream it cannot fit down our link and resumes
  // it later. Without this the tile just freezes on the last frame.
  room.on(
    RoomEvent.TrackStreamStateChanged,
    (publication: TrackPublication, streamState: Track.StreamState, participant: Participant) => {
      if (publication.source !== Track.Source.Camera) return;
      store.dispatch(
        updateParticipant({
          pubkey: participant.identity,
          videoPaused: streamState === Track.StreamState.Paused,
        }),
      );
    },
  );

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
    void e2ee?.onReconnected().catch((err) => e2eeLog.warn("re-keying after reconnect failed", err));
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
    if (currentRoom === room) currentRoom = null;
    disposeE2EE(e2ee);
    // A superseded room: its session state was already handed to (or reset
    // for) the newer one. Wiping Redux / notifying the call service here would
    // drop the call that replaced it.
    if (latestRoom !== room) {
      log.info("ignoring Disconnected from a superseded room");
      return;
    }
    latestRoom = null;
    cleanupListenTogether();
    clearRemoteAudio();
    store.dispatch(disconnectRoom());
    notifyTopology();
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
    (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
      encryptionType?: Encryption_Type,
    ) => {
      if (topic !== LISTEN_TOGETHER_TOPIC || !participant) return;
      // In an encrypted room every data packet is GCM-encrypted with the
      // sender's key. A plaintext packet did not come from a peer that holds
      // one (an outdated client, or something injected at the SFU) — ignore.
      if (e2ee && encryptionType === Encryption_Type.NONE) {
        e2eeLog.warn(`dropping PLAINTEXT data packet from ${shortKey(participant.identity)}`);
        return;
      }

      const msg = decodeLTMessage(payload);
      if (msg) {
        handleIncomingMessage(msg, participant.identity);
      }
    },
  );

  // Listen Together: drop departed listeners; the DJ leaving ends the session
  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    handleParticipantLeft(participant.identity);
  });

  log.info(`connecting to ${serverUrl}${e2ee ? " (e2ee)" : ""}`);
  try {
    if (e2ee) {
      // Before connect (see the doc comment): encoder on, pre-known keys in.
      await room.setE2EEEnabled(true);
      await e2ee.installInitialKeys();
    }
    await room.connect(serverUrl, token);
  } catch (err) {
    // Nothing past this point owns the Room or the worker yet — tear both
    // down here so a bad invite secret can't leave a cryptor worker alive.
    disposeE2EE(e2ee);
    void room.disconnect().catch(() => {});
    // Torn down mid-connect by an account change: not a join failure.
    if (!isMediaEpochCurrent(epoch)) throw new MediaSessionAbortedError();
    throw err;
  }
  if (!isMediaEpochCurrent(epoch)) {
    // The account changed while we were connecting. Leave without touching
    // the new account's state (treated as superseded) and without the E2EE
    // session ever starting its key fan-out.
    log.info("account changed during connect — leaving the room");
    if (latestRoom === room) latestRoom = null;
    disposeE2EE(e2ee);
    await room.disconnect().catch(() => {});
    throw new MediaSessionAbortedError();
  }
  log.info(
    `room connected participants=${room.remoteParticipants.size} canPlaybackAudio=${room.canPlaybackAudio}`,
  );
  if (e2ee && myPubkey && room.localParticipant.identity !== myPubkey) {
    // The backend mints identity = pubkey; keys are addressed by pubkey, so a
    // mismatch would leave our own key under the wrong name.
    console.error(
      `[LiveKit] identity mismatch: token identity ${shortKey(room.localParticipant.identity)} != pubkey ${shortKey(myPubkey)}`,
    );
  }

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
  // Tiles that mounted before the room existed can resolve their tracks now.
  notifyTopology();
  if (e2ee) {
    for (const p of room.remoteParticipants.values()) joinedAt.set(p.identity, Date.now());
    await e2ee.start([...room.remoteParticipants.keys()]);
  }
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
    // Unknown until a track is subscribed (LiveKit's getter is false with no
    // publications, which would read as "outdated client").
    encrypted: participant.trackPublications?.size > 0 ? participant.isEncrypted : undefined,
  };
}

/**
 * Disconnect from the current LiveKit room.
 */
export async function disconnectFromRoom(): Promise<void> {
  const room = currentRoom;
  if (room) {
    // Listen Together goodbyes need the data channel — send them first
    // (under E2EE they are encrypted with our sender key, so the session
    // must still be alive here; it is disposed by the Disconnected handler).
    // Best effort: a failed goodbye must never keep the room connected.
    await announceListenTogetherExit().catch(() => {});
    await room.disconnect();
    if (currentRoom === room) currentRoom = null;
  }
  disposeE2EE(currentE2EE);
}

// Account change (switch / add / log out): hard-stop whatever room exists,
// connected or still connecting. The graceful part (presence clear, "call
// missed") already ran in `endMediaSessionsForAccountChange` while the old
// account's signer was still active; this is the backstop that guarantees no
// room outlives its account.
onAbandonMediaSessions(async () => {
  const pending = latestRoom && latestRoom !== currentRoom ? latestRoom : null;
  await disconnectFromRoom();
  if (pending) await pending.disconnect().catch(() => {});
});

// A remote audio element the WebView paused and would not let us resume
// needs the same user gesture as an autoplay block: raise the same pill.
setRemoteAudioBlockedHandler(() => {
  if (currentRoom) store.dispatch(setAudioPlaybackBlocked(true));
});

/**
 * (Re)start remote audio playback. Must run inside a user gesture (the
 * "Enable audio" pill). Covers both ways playback gets stuck: the SDK's
 * autoplay block, and an element the WebView paused that the SDK still
 * believes is playing (so it would never report a status change).
 */
export async function resumeAudioPlayback(): Promise<void> {
  const room = currentRoom;
  if (!room) return;
  try {
    await room.startAudio();
    resumeRemoteAudio();
  } finally {
    if (currentRoom === room) {
      store.dispatch(setAudioPlaybackBlocked(!room.canPlaybackAudio));
    }
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
 *  - contentHint "detail" + 1080p15 for text (the default), or "motion" +
 *    1080p30 with the smooth-motion preference.
 */
export async function setScreenShareEnabled(enabled: boolean): Promise<void> {
  if (!currentRoom) return;
  if (!enabled) {
    await currentRoom.localParticipant.setScreenShareEnabled(false);
    return;
  }
  const motion = getMediaPrefs().screenShareMotion;
  // A preset's `resolution` carries its frame rate, so the capture has to
  // come from the same preset as the encoding: capturing with the 15 fps one
  // capped "smooth motion" at 15 fps however the encoder was set.
  const preset = motion ? ScreenSharePresets.h1080fps30 : ScreenSharePresets.h1080fps15;
  await currentRoom.localParticipant.setScreenShareEnabled(
    true,
    {
      audio: isWindows,
      systemAudio: isWindows ? "include" : "exclude",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      contentHint: motion ? "motion" : "detail",
      resolution: preset.resolution,
    },
    {
      screenShareEncoding: preset.encoding,
      // The room default ("balanced") is chosen for faces. Under congestion a
      // text share must stay sharp and lose frames; a motion share the reverse.
      degradationPreference: motion ? "maintain-framerate" : "maintain-resolution",
    },
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

/** Everyone who resolves tracks (video tiles). Deliberately not bound to one
 *  Room: see `onTrackTopologyChanged`. */
const topologyListeners = new Set<() => void>();

function notifyTopology(): void {
  for (const cb of [...topologyListeners]) cb();
}

/**
 * Fires whenever a track may have changed: (un)published, (un)subscribed,
 * (un)muted, and when the room itself comes up or goes away.
 *
 * Subscriptions outlive any single Room. They used to be bound to whatever
 * room existed at subscribe time, and did nothing if there was none — but a
 * 1:1 call renders its tiles the moment the call starts, before the room is
 * connected, so the self-view never learned its camera had been published
 * and stayed black for the whole call.
 */
export function onTrackTopologyChanged(cb: () => void): () => void {
  topologyListeners.add(cb);
  return () => {
    topologyListeners.delete(cb);
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
      ...audioProcessingConstraints(prefs),
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
    // Lost = they dropped off and may come back. The tile badge has one
    // "bad" state; this is the worst of it, not "unknown".
    case ConnectionQuality.Lost:
      return "poor";
    default:
      return "unknown";
  }
}
