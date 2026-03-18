import { cn } from "@/lib/utils";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Monitor,
  Video,
  VideoOff,
  PhoneOff,
  Settings,
} from "lucide-react";
import { useVoiceChannel } from "./useVoiceChannel";

interface VoiceControlsProps {
  showVideo?: boolean;
  onSettingsClick?: () => void;
}

/**
 * Bottom control bar for voice/video channels.
 * Discord-style rounded buttons with active/inactive states.
 */
export function VoiceControls({ showVideo = false, onSettingsClick }: VoiceControlsProps) {
  const {
    localState,
    leave,
    toggleMute,
    toggleDeafen,
    toggleVideo,
    toggleScreenShare,
  } = useVoiceChannel();

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-edge/50 bg-surface/50 px-4 py-3 backdrop-blur-sm">
      {/* Video toggle (only for video channels) */}
      {showVideo && (
        <ControlButton
          onClick={toggleVideo}
          active={localState.videoEnabled}
          icon={localState.videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
          label={localState.videoEnabled ? "Turn off camera" : "Turn on camera"}
          danger={!localState.videoEnabled}
        />
      )}

      {/* Screen share */}
      <ControlButton
        onClick={toggleScreenShare}
        active={localState.screenSharing}
        icon={<Monitor size={18} />}
        label={localState.screenSharing ? "Stop sharing" : "Share screen"}
        accent={localState.screenSharing}
      />

      {/* Mute */}
      <ControlButton
        onClick={toggleMute}
        active={!localState.muted}
        icon={localState.muted ? <MicOff size={18} /> : <Mic size={18} />}
        label={localState.muted ? "Unmute" : "Mute"}
        danger={localState.muted}
      />

      {/* Deafen */}
      <ControlButton
        onClick={toggleDeafen}
        active={!localState.deafened}
        icon={localState.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
        label={localState.deafened ? "Undeafen" : "Deafen"}
        danger={localState.deafened}
      />

      {/* Settings */}
      {onSettingsClick && (
        <button
          onClick={onSettingsClick}
          className="rounded-full p-2.5 text-soft hover:bg-white/10 hover:text-heading transition-colors"
          title="Voice settings"
        >
          <Settings size={18} />
        </button>
      )}

      {/* Disconnect — always red */}
      <button
        onClick={leave}
        className="ml-1 rounded-full bg-red-500 p-2.5 text-white hover:bg-red-600 transition-colors"
        title="Disconnect"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}

function ControlButton({
  onClick,
  active,
  icon,
  label,
  danger,
  accent,
}: {
  onClick: () => void;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full p-2.5 transition-colors",
        accent
          ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
          : danger
            ? "bg-white/10 text-red-400 hover:bg-white/15"
            : active
              ? "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"
              : "bg-white/10 text-white/50 hover:bg-white/15",
      )}
      title={label}
    >
      {icon}
    </button>
  );
}
