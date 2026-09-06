import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  toggleMute,
  toggleDeafen,
  toggleVideo,
  setScreenSharing,
  setScreenSharePending,
  setMediaError,
} from "@/store/slices/voiceSlice";
import { describeMediaError } from "@/lib/webrtc/mediaDevices";
import {
  selectIsInVoice,
  selectConnectedRoom,
  selectIsVoiceConnecting,
  selectVoiceLocalState,
  selectVoiceConnectionQuality,
} from "./voiceSelectors";
import {
  joinVoiceChannel,
  leaveVoiceChannel,
  syncLocalAudioState,
  toggleCamera,
  toggleScreenShare as toggleScreenShareService,
} from "./voiceService";

/**
 * Hook for voice channel connection and controls.
 */
export function useVoiceChannel() {
  const dispatch = useAppDispatch();
  const isConnected = useAppSelector(selectIsInVoice);
  const connectedRoom = useAppSelector(selectConnectedRoom);
  const isConnecting = useAppSelector(selectIsVoiceConnecting);
  const localState = useAppSelector(selectVoiceLocalState);
  const connectionQuality = useAppSelector(selectVoiceConnectionQuality);

  const join = useCallback(
    async (spaceId: string, channelId: string) => {
      try {
        await joinVoiceChannel(spaceId, channelId);
      } catch (err) {
        console.error("[voice] Failed to join:", err);
        throw err;
      }
    },
    [],
  );

  const leave = useCallback(async () => {
    try {
      await leaveVoiceChannel();
    } catch (err) {
      console.error("[voice] Failed to leave:", err);
    }
  }, []);

  const handleToggleMute = useCallback(async () => {
    dispatch(toggleMute());
    try {
      await syncLocalAudioState();
    } catch {
      // Revert state on failure
      dispatch(toggleMute());
    }
  }, [dispatch]);

  const handleToggleDeafen = useCallback(async () => {
    dispatch(toggleDeafen());
    try {
      await syncLocalAudioState();
    } catch {
      // Revert state on failure (toggleDeafen is symmetric)
      dispatch(toggleDeafen());
    }
  }, [dispatch]);

  const handleToggleVideo = useCallback(async () => {
    dispatch(toggleVideo());
    try {
      await toggleCamera();
    } catch {
      dispatch(toggleVideo());
    }
  }, [dispatch]);

  const handleToggleScreenShare = useCallback(async () => {
    if (localState.screenSharing) {
      // Stopping is immediate — flip first so the tile disappears at once.
      dispatch(setScreenSharing(false));
      try {
        await toggleScreenShareService(false);
      } catch {
        dispatch(setScreenSharing(true));
      }
      return;
    }
    if (localState.screenSharePending) return;
    // Starting: the OS picker is open until this resolves. Only then is
    // anything actually being shared.
    dispatch(setScreenSharePending(true));
    try {
      await toggleScreenShareService(true);
      dispatch(setScreenSharing(true));
    } catch (err) {
      dispatch(setScreenSharePending(false));
      // NotAllowedError = the user closed the picker; anything else is real.
      if ((err as { name?: string } | null)?.name !== "NotAllowedError") {
        dispatch(setMediaError(describeMediaError(err, "screen")));
      }
    }
  }, [dispatch, localState.screenSharing, localState.screenSharePending]);

  return {
    isConnected,
    isConnecting,
    connectedRoom,
    localState,
    connectionQuality,
    join,
    leave,
    toggleMute: handleToggleMute,
    toggleDeafen: handleToggleDeafen,
    toggleVideo: handleToggleVideo,
    toggleScreenShare: handleToggleScreenShare,
  };
}
