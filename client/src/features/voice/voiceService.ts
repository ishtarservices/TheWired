import { store } from "@/store";
import {
  setConnecting,
  setConnectedRoom,
  disconnectRoom,
  setMuted,
  setMediaError,
} from "@/store/slices/voiceSlice";
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
import { describeMediaError } from "@/lib/webrtc/mediaDevices";
import { publishRoomPresence, clearRoomPresence } from "@/lib/nostr/roomPresence";

/**
 * Enable the mic, surfacing failure instead of swallowing it. Before this
 * a denied/busy microphone (Windows: permission prompt dismissed, or another
 * app holding the device) left the user in the room, shown as unmuted, and
 * silent — they only found out from the other side.
 */
async function enableMicrophoneOrExplain(): Promise<boolean> {
  try {
    await setMicrophoneEnabled(true);
    store.dispatch(setMediaError(null));
    return true;
  } catch (err) {
    const msg = describeMediaError(err, "microphone");
    console.warn("[voice] Could not enable mic:", msg);
    store.dispatch(setMuted(true));
    store.dispatch(setMediaError(msg));
    return false;
  }
}

/** "Retry mic" action for the media-error banner. */
export async function retryMicrophone(): Promise<void> {
  if (await enableMicrophoneOrExplain()) {
    store.dispatch(setMuted(false));
  }
}

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

    // Enable microphone after connecting. Awaited so the OS permission
    // prompt happens under the "Connecting…" state; failure is surfaced
    // (banner + muted) rather than swallowed.
    await enableMicrophoneOrExplain();

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
    // disconnectRoom resets mediaError — set it AFTER so the pre-join view
    // can show why the join failed instead of an unhandled rejection.
    store.dispatch(setMediaError(describeJoinError(err)));
    throw err;
  }
}

/** Readable reason for a failed join (LiveKit unreachable is the common one). */
function describeJoinError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = (err as { message?: string } | null)?.message ?? String(err);
  if (name === "ConnectionError" || /pc connection|connect to|websocket/i.test(message)) {
    return "Could not connect to the voice server. Check that LiveKit is running and reachable (media ports 7881/7882), then try again.";
  }
  if (/403|forbidden|permission/i.test(message)) {
    return "You don't have permission to join this channel.";
  }
  return `Could not join: ${message}`;
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
 * Start/stop screen sharing. Starting opens the OS picker and resolves only
 * once the user picked something (or rejects with NotAllowedError on
 * cancel) — callers should mark the share live AFTER this resolves, not
 * before, or the UI claims "you're sharing" while the picker is still up.
 * With no argument, applies the current Redux flag (used by the stop pill).
 */
export async function toggleScreenShare(enabled?: boolean): Promise<void> {
  const target = enabled ?? store.getState().voice.localState.screenSharing;
  await setScreenShareEnabled(target);
}
