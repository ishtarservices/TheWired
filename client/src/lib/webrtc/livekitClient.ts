import {
  Room,
  RoomEvent,
  Track,
  ConnectionQuality,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type Participant,
  DisconnectReason,
} from "livekit-client";
import { store } from "@/store";
import {
  addParticipant,
  removeParticipant,
  updateParticipant,
  setActiveSpeakers,
  setConnectionQuality,
  disconnectRoom,
} from "@/store/slices/voiceSlice";
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

/** Get the current LiveKit room (or null if not connected) */
export function getLivekitRoom(): Room | null {
  return currentRoom;
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

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
      resolution: { width: 640, height: 360, frameRate: 24 },
    },
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // Wire up room events to Redux
  room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
    store.dispatch(
      addParticipant({
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
      }),
    );
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    store.dispatch(removeParticipant(participant.identity));
  });

  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    store.dispatch(setActiveSpeakers(speakers.map((s) => s.identity)));
  });

  room.on(
    RoomEvent.ConnectionQualityChanged,
    (quality: ConnectionQuality, participant: Participant) => {
      if (participant instanceof room.localParticipant.constructor) {
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
    if (publication.source === Track.Source.Microphone) {
      store.dispatch(
        updateParticipant({
          pubkey: participant.identity,
          isMuted: true,
        }),
      );
    }
  });

  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    if (publication.source === Track.Source.Microphone) {
      store.dispatch(
        updateParticipant({
          pubkey: participant.identity,
          isMuted: false,
        }),
      );
    }
  });

  room.on(
    RoomEvent.TrackSubscribed,
    (_track, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (publication.source === Track.Source.Camera) {
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            hasVideo: true,
          }),
        );
      } else if (publication.source === Track.Source.ScreenShare) {
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            isScreenSharing: true,
          }),
        );
      }
    },
  );

  room.on(
    RoomEvent.TrackUnsubscribed,
    (_track, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (publication.source === Track.Source.Camera) {
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            hasVideo: false,
          }),
        );
      } else if (publication.source === Track.Source.ScreenShare) {
        store.dispatch(
          updateParticipant({
            pubkey: participant.identity,
            isScreenSharing: false,
          }),
        );
      }
    },
  );

  room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    console.log(
      `[LiveKit] Disconnected: reason=${disconnectReasonName(reason)} (${reason ?? "?"}) ` +
        `state=${room.state}`,
    );
    cleanupListenTogether();
    store.dispatch(disconnectRoom());
    currentRoom = null;
  });

  room.on(RoomEvent.Reconnecting, () => {
    console.log("[LiveKit] Reconnecting...");
  });

  room.on(RoomEvent.Reconnected, () => {
    console.log("[LiveKit] Reconnected");
  });

  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    console.log(`[LiveKit] ConnectionState → ${state}`);
  });

  room.on(RoomEvent.MediaDevicesError, (error) => {
    console.error(`[LiveKit] MediaDevicesError:`, error);
  });

  room.on(RoomEvent.SignalConnected, () => {
    console.log(`[LiveKit] signal connected`);
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
  console.log(`[LiveKit] connecting to ${serverUrl}`);
  await room.connect(serverUrl, token);
  console.log(`[LiveKit] connect() resolved — state=${room.state} sid=${room.localParticipant.sid ?? "?"}`);

  // Add existing participants
  for (const participant of room.remoteParticipants.values()) {
    store.dispatch(
      addParticipant({
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
      }),
    );
  }

  currentRoom = room;
  return room;
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
 */
export async function setScreenShareEnabled(enabled: boolean): Promise<void> {
  if (!currentRoom) return;
  await currentRoom.localParticipant.setScreenShareEnabled(enabled);
}

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
