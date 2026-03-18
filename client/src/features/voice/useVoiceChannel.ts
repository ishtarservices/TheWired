import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  toggleMute,
  toggleDeafen,
  toggleVideo,
  setScreenSharing,
} from "@/store/slices/voiceSlice";
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
  toggleMicrophone,
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
      await toggleMicrophone();
    } catch {
      // Revert state on failure
      dispatch(toggleMute());
    }
  }, [dispatch]);

  const handleToggleDeafen = useCallback(() => {
    dispatch(toggleDeafen());
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
    const newState = !localState.screenSharing;
    dispatch(setScreenSharing(newState));
    try {
      await toggleScreenShareService();
    } catch {
      dispatch(setScreenSharing(!newState));
    }
  }, [dispatch, localState.screenSharing]);

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
