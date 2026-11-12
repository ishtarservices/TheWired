import { CallControlButton } from "@/features/media/CallControlButton";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Monitor,
  Video,
  VideoOff,
  PhoneOff,
  Music,
  Loader2,
} from "lucide-react";
import { useVoiceChannel } from "./useVoiceChannel";
import { useListenTogether } from "@/features/listenTogether/useListenTogether";
import { DeviceMenuButton } from "./devices/DeviceMenuButton";
import { SHORTCUT } from "@/hooks/useCallShortcuts";

interface VoiceControlsProps {
  showVideo?: boolean;
  /** Permission flags — when false, the button is hidden */
  canSpeak?: boolean;
  canVideo?: boolean;
  canScreenShare?: boolean;
}

/**
 * Bottom control bar for voice/video channels. Same buttons and tones as
 * the 1:1 call bar (`CallControlButton`).
 */
export function VoiceControls({
  showVideo = false,
  canSpeak = true,
  canVideo = true,
  canScreenShare = true,
}: VoiceControlsProps) {
  const {
    localState,
    leave,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
  } = useVoiceChannel();

  const { active: ltActive, togglePicker, pickerOpen } = useListenTogether();

  const sharePending = !!localState.screenSharePending;

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-3 bg-panel/80 backdrop-blur-sm">
      <CallControlButton
        label={ltActive ? "Music (session active)" : "Listen Together"}
        tone={ltActive ? "accent" : "neutral"}
        pressed={pickerOpen}
        onClick={togglePicker}
      >
        <Music size={18} />
      </CallControlButton>

      {/* Camera (video channels, with the VIDEO permission) */}
      {showVideo && canVideo && (
        <CallControlButton
          label={`${localState.videoEnabled ? "Turn off camera" : "Turn on camera"} (${SHORTCUT.camera})`}
          tone={localState.videoEnabled ? "neutral" : "danger"}
          pressed={localState.videoEnabled}
          onClick={() => void toggleVideo()}
        >
          {localState.videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
        </CallControlButton>
      )}

      {/* Screen share (requires SCREEN_SHARE permission) */}
      {canScreenShare && (
        <CallControlButton
          label={
            sharePending
              ? "Choose a window or screen in the system picker…"
              : localState.screenSharing
                ? "Stop sharing"
                : "Share screen"
          }
          tone={localState.screenSharing || sharePending ? "accent" : "neutral"}
          pressed={localState.screenSharing}
          onClick={() => void toggleScreenShare()}
        >
          {sharePending ? <Loader2 size={18} className="animate-spin" /> : <Monitor size={18} />}
        </CallControlButton>
      )}

      {/* Mute (requires SPEAK permission to unmute) */}
      <CallControlButton
        label={`${localState.muted ? (canSpeak ? "Unmute" : "No speak permission") : "Mute"} (${SHORTCUT.mute})`}
        tone={localState.muted ? "danger" : "neutral"}
        pressed={!localState.muted}
        onClick={() => void toggleMute()}
      >
        {localState.muted ? <MicOff size={18} /> : <Mic size={18} />}
      </CallControlButton>

      <CallControlButton
        label={`${localState.deafened ? "Undeafen" : "Deafen"} (${SHORTCUT.deafen})`}
        tone={localState.deafened ? "danger" : "neutral"}
        pressed={!localState.deafened}
        onClick={() => void toggleDeafen()}
      >
        {localState.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </CallControlButton>

      {/* Devices (mic / speaker / camera) */}
      <DeviceMenuButton className="p-2.5" hideCamera={!showVideo} />

      <CallControlButton label="Disconnect" tone="end" className="ml-1" onClick={() => void leave()}>
        <PhoneOff size={18} />
      </CallControlButton>
    </div>
  );
}
