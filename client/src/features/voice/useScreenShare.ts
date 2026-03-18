import { useState, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setScreenSharing } from "@/store/slices/voiceSlice";
import { setScreenShareEnabled } from "@/lib/webrtc/livekitClient";
import { supportsScreenShare } from "@/lib/webrtc/mediaDevices";

/**
 * Hook for screen sharing in voice channels.
 */
export function useScreenShare() {
  const dispatch = useAppDispatch();
  const isSharing = useAppSelector((s) => s.voice.localState.screenSharing);
  const [error, setError] = useState<string | null>(null);

  const isSupported = supportsScreenShare();

  const startScreenShare = useCallback(async () => {
    if (!isSupported) {
      setError("Screen sharing is not supported in this browser");
      return;
    }

    try {
      setError(null);
      await setScreenShareEnabled(true);
      dispatch(setScreenSharing(true));
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        // User cancelled the screen share picker
        return;
      }
      setError(err.message ?? "Failed to start screen sharing");
      dispatch(setScreenSharing(false));
    }
  }, [dispatch, isSupported]);

  const stopScreenShare = useCallback(async () => {
    try {
      await setScreenShareEnabled(false);
      dispatch(setScreenSharing(false));
      setError(null);
    } catch (err: any) {
      console.error("[screenShare] Failed to stop:", err);
    }
  }, [dispatch]);

  const toggle = useCallback(async () => {
    if (isSharing) {
      await stopScreenShare();
    } else {
      await startScreenShare();
    }
  }, [isSharing, startScreenShare, stopScreenShare]);

  return {
    isSharing,
    isSupported,
    error,
    startScreenShare,
    stopScreenShare,
    toggle,
  };
}
