import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Music,
  Loader2,
} from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  toggleCallMute,
  toggleCallVideo,
  setCallScreenSharing,
  setCallScreenSharePending,
} from "@/store/slices/callSlice";
import { setMediaError } from "@/store/slices/voiceSlice";
import { describeMediaError } from "@/lib/webrtc/mediaDevices";
import {
  hangupCall,
  setCallMuted,
  setCallVideoEnabled,
  setCallScreenShare,
} from "./callService";
import { cn } from "@/lib/utils";
import { useListenTogether } from "@/features/listenTogether/useListenTogether";
import { DeviceMenuButton } from "@/features/voice/devices/DeviceMenuButton";
import { SHORTCUT } from "@/hooks/useCallShortcuts";

export function CallControls() {
  const dispatch = useAppDispatch();
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const { active: ltActive, togglePicker, pickerOpen } = useListenTogether();

  if (!activeCall) return null;

  // Optimistic flag flip + apply to the real media; revert on failure.
  // The flags alone are cosmetic — the tracks keep transmitting (audit C4).
  const handleMute = async () => {
    const next = !activeCall.isMuted;
    dispatch(toggleCallMute());
    try {
      await setCallMuted(next);
    } catch {
      dispatch(toggleCallMute());
    }
  };

  const handleVideo = async () => {
    const next = !activeCall.isVideoEnabled;
    dispatch(toggleCallVideo());
    try {
      await setCallVideoEnabled(next);
    } catch {
      dispatch(toggleCallVideo());
    }
  };

  const handleScreenShare = async () => {
    if (activeCall.isScreenSharing) {
      dispatch(setCallScreenSharing(false));
      try {
        await setCallScreenShare(false);
      } catch {
        dispatch(setCallScreenSharing(true));
      }
      return;
    }
    if (activeCall.isScreenSharePending) return;
    // The OS picker is open until this resolves — only then is it live.
    dispatch(setCallScreenSharePending(true));
    try {
      await setCallScreenShare(true);
      dispatch(setCallScreenSharing(true));
    } catch (err) {
      dispatch(setCallScreenSharePending(false));
      if ((err as { name?: string } | null)?.name !== "NotAllowedError") {
        dispatch(setMediaError(describeMediaError(err, "screen")));
      }
    }
  };

  return (
    <div className="flex items-center justify-center gap-3">
      {/* Listen Together — music button */}
      <button
        onClick={togglePicker}
        className={cn(
          "rounded-full p-3 transition-colors",
          ltActive
            ? "bg-primary/20 text-primary"
            : pickerOpen
              ? "bg-surface-hover text-heading"
              : "bg-surface-hover text-heading",
        )}
        title={ltActive ? "Music (session active)" : "Listen Together"}
      >
        <Music size={20} />
      </button>

      {/* Mute */}
      <button
        onClick={handleMute}
        className={cn(
          "rounded-full p-3 transition-colors",
          activeCall.isMuted
            ? "bg-red-500/20 text-red-400"
            : "bg-surface-hover text-heading",
        )}
        title={`${activeCall.isMuted ? "Unmute" : "Mute"} (${SHORTCUT.mute})`}
      >
        {activeCall.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>

      {/* Video */}
      {activeCall.callType === "video" && (
        <button
          onClick={handleVideo}
          className={cn(
            "rounded-full p-3 transition-colors",
            !activeCall.isVideoEnabled
              ? "bg-red-500/20 text-red-400"
              : "bg-surface-hover text-heading",
          )}
          title={`${activeCall.isVideoEnabled ? "Turn off camera" : "Turn on camera"} (${SHORTCUT.camera})`}
        >
          {activeCall.isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
      )}

      {/* Screen Share */}
      {(
        <button
          onClick={handleScreenShare}
          className={cn(
            "rounded-full p-3 transition-colors",
            activeCall.isScreenSharing
              ? "bg-blue-500/20 text-blue-400"
              : "bg-surface-hover text-heading",
          )}
          title={
            activeCall.isScreenSharePending
              ? "Choose a window or screen in the system picker…"
              : activeCall.isScreenSharing
                ? "Stop sharing"
                : "Share screen"
          }
        >
          {activeCall.isScreenSharePending ? (
            <Loader2 size={20} className="animate-spin" />
          ) : activeCall.isScreenSharing ? (
            <Monitor size={20} />
          ) : (
            <MonitorOff size={20} />
          )}
        </button>
      )}

      {/* Devices (mic / speaker / camera) */}
      <DeviceMenuButton className="p-3" size={20} hideCamera={activeCall.callType !== "video"} />

      {/* Hangup */}
      <button
        onClick={() => hangupCall()}
        className="rounded-full bg-red-500 p-3 text-white hover:bg-red-600 transition-colors"
        title="End call"
      >
        <PhoneOff size={20} />
      </button>
    </div>
  );
}
