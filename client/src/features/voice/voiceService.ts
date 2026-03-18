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
import { publishRoomPresence, clearRoomPresence } from "@/lib/nostr/roomPresence";

/**
 * Join a voice channel in a space.
 * Fetches a LiveKit token, connects to the room, and publishes presence.
 */
export async function joinVoiceChannel(
  spaceId: string,
  channelId: string,
): Promise<void> {
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
 * Toggle microphone mute state.
 * Note: Redux state is toggled *before* this is called, so we read the new state.
 * muted=true means mic should be disabled.
 */
export async function toggleMicrophone(): Promise<void> {
  const { muted } = store.getState().voice.localState;
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
