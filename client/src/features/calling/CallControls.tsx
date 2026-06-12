import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Music,
} from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { toggleCallMute, toggleCallVideo, toggleCallScreenShare } from "@/store/slices/callSlice";
import {
  hangupCall,
  setCallMuted,
  setCallVideoEnabled,
  setCallScreenShare,
} from "./callService";
import { cn } from "@/lib/utils";
import { useListenTogether } from "@/features/listenTogether/useListenTogether";

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
    const next = !activeCall.isScreenSharing;
    dispatch(toggleCallScreenShare());
    try {
      await setCallScreenShare(next);
    } catch {
      dispatch(toggleCallScreenShare());
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
        title={activeCall.isMuted ? "Unmute" : "Mute"}
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
          title={activeCall.isVideoEnabled ? "Turn off camera" : "Turn on camera"}
        >
          {activeCall.isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
      )}

      {/* Screen Share — SFU mode only; P2P has no renegotiation path, so a
          button there would silently do nothing */}
      {activeCall.isSfuFallback && (
        <button
          onClick={handleScreenShare}
          className={cn(
            "rounded-full p-3 transition-colors",
            activeCall.isScreenSharing
              ? "bg-blue-500/20 text-blue-400"
              : "bg-surface-hover text-heading",
          )}
          title={activeCall.isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          {activeCall.isScreenSharing ? <Monitor size={20} /> : <MonitorOff size={20} />}
        </button>
      )}

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
