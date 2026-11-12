import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
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
import { CallControlButton } from "@/features/media/CallControlButton";
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

  const sharing = activeCall.isScreenSharing;
  const sharePending = !!activeCall.isScreenSharePending;

  return (
    <div className="flex items-center justify-center gap-3">
      <CallControlButton
        size="lg"
        label={ltActive ? "Music (session active)" : "Listen Together"}
        tone={ltActive ? "accent" : "neutral"}
        pressed={pickerOpen}
        onClick={togglePicker}
      >
        <Music size={20} />
      </CallControlButton>

      <CallControlButton
        size="lg"
        label={`${activeCall.isMuted ? "Unmute" : "Mute"} (${SHORTCUT.mute})`}
        tone={activeCall.isMuted ? "danger" : "neutral"}
        pressed={!activeCall.isMuted}
        onClick={() => void handleMute()}
      >
        {activeCall.isMuted ? <MicOff size={20} /> : <Mic size={20} />}
      </CallControlButton>

      {activeCall.callType === "video" && (
        <CallControlButton
          size="lg"
          label={`${activeCall.isVideoEnabled ? "Turn off camera" : "Turn on camera"} (${SHORTCUT.camera})`}
          tone={activeCall.isVideoEnabled ? "neutral" : "danger"}
          pressed={activeCall.isVideoEnabled}
          onClick={() => void handleVideo()}
        >
          {activeCall.isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </CallControlButton>
      )}

      <CallControlButton
        size="lg"
        label={
          sharePending
            ? "Choose a window or screen in the system picker…"
            : sharing
              ? "Stop sharing"
              : "Share screen"
        }
        tone={sharing || sharePending ? "accent" : "neutral"}
        pressed={sharing}
        onClick={() => void handleScreenShare()}
      >
        {sharePending ? <Loader2 size={20} className="animate-spin" /> : <Monitor size={20} />}
      </CallControlButton>

      {/* Devices (mic / speaker / camera) */}
      <DeviceMenuButton className="p-3" size={20} hideCamera={activeCall.callType !== "video"} />

      <CallControlButton size="lg" label="End call" tone="end" onClick={() => void hangupCall()}>
        <PhoneOff size={20} />
      </CallControlButton>
    </div>
  );
}
