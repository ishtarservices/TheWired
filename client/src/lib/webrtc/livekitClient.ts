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
      resolution: { width: 1280, height: 720, frameRate: 30 },
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
    console.log("[LiveKit] Disconnected:", reason);
    store.dispatch(disconnectRoom());
    currentRoom = null;
  });

  room.on(RoomEvent.Reconnecting, () => {
    console.log("[LiveKit] Reconnecting...");
  });

  room.on(RoomEvent.Reconnected, () => {
    console.log("[LiveKit] Reconnected");
  });

  // Connect
  await room.connect(serverUrl, token);

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
