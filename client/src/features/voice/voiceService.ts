import { store } from "@/store";
import { setConnecting, setConnectedRoom, disconnectRoom } from "@/store/slices/voiceSlice";
import { fetchVoiceToken } from "@/lib/api/voice";
import { api } from "@/lib/api/client";
import {
  connectToRoom,
  disconnectFromRoom,
  setMicrophoneEnabled,
  setCameraEnabled,
  setScreenShareEnabled,
} from "@/lib/webrtc/livekitClient";
import { setRemoteAudioOutputMuted } from "@/lib/webrtc/remoteAudio";
import { publishRoomPresence, clearRoomPresence } from "@/lib/nostr/roomPresence";

/**
 * Join a voice channel in a space.
 * Fetches a LiveKit token, connects to the room, and publishes presence.
 */
export async function joinVoiceChannel(
  spaceId: string,
  channelId: string,
): Promise<void> {
  // The LiveKit room singleton is shared with SFU 1:1 calls — connecting
  // here would silently tear that room down and leave callSlice stuck on
  // "active". End the call cleanly first.
  if (store.getState().call.activeCall) {
    const { hangupCall } = await import("@/features/calling/callService");
    await hangupCall().catch(() => {});
  }

  store.dispatch(setConnecting(true));

  try {
    // Fetch LiveKit token from backend
    const { token, url, roomName } = await fetchVoiceToken(spaceId, channelId);

    // Connect to LiveKit room
    await connectToRoom(url, token);

    // Enable microphone after connecting (non-blocking — may fail on insecure contexts)
    setMicrophoneEnabled(true).catch((err) => {
      console.warn("[voice] Could not enable mic:", err.message);
    });

    // Update Redux state
    store.dispatch(
      setConnectedRoom({
        room: { spaceId, channelId, roomName },
        token,
        serverUrl: url,
      }),
    );

    // Publish Nostr presence
    const roomRef = `30312:${spaceId}:${channelId}`;
    await publishRoomPresence(roomRef).catch((err) => {
      console.warn("[voice] Failed to publish presence:", err);
    });
  } catch (err) {
    store.dispatch(disconnectRoom());
    throw err;
  }
}

/**
 * Leave the current voice channel.
 */
export async function leaveVoiceChannel(): Promise<void> {
  // Disconnect from LiveKit
  await disconnectFromRoom();

  // Clear Nostr presence
  await clearRoomPresence().catch((err) => {
    console.warn("[voice] Failed to clear presence:", err);
  });

  // Update Redux state
  store.dispatch(disconnectRoom());

  // Trigger temporary channel cleanup (non-blocking)
  api("/voice/cleanup-temporary", { method: "POST" }).catch(() => {});
}

/**
 * Sync the actual audio hardware/output state from Redux localState.
 * Note: the reducer (toggleMute/toggleDeafen) runs *before* this is called,
 * so we read the new state and apply it absolutely — no toggle drift.
 *
 * Covers both halves of deafen (#7/#8): mic publish state AND remote
 * audio output mute.
 */
export async function syncLocalAudioState(): Promise<void> {
  const { muted, deafened } = store.getState().voice.localState;
  setRemoteAudioOutputMuted(deafened);
  await setMicrophoneEnabled(!muted);
}

/**
 * Toggle camera on/off.
 * Note: Redux state is toggled *before* this is called.
 */
export async function toggleCamera(): Promise<void> {
  const { videoEnabled } = store.getState().voice.localState;
  await setCameraEnabled(videoEnabled);
}

/**
 * Toggle screen sharing on/off.
 * Note: Redux state is toggled *before* this is called.
 */
export async function toggleScreenShare(): Promise<void> {
  const { screenSharing } = store.getState().voice.localState;
  await setScreenShareEnabled(screenSharing);
}
