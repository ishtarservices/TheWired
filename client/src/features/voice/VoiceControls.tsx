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
  Music,
} from "lucide-react";
import { useVoiceChannel } from "./useVoiceChannel";
import { useListenTogether } from "@/features/listenTogether/useListenTogether";

interface VoiceControlsProps {
  showVideo?: boolean;
  onSettingsClick?: () => void;
  /** Permission flags — when false, the button is hidden */
  canSpeak?: boolean;
  canVideo?: boolean;
  canScreenShare?: boolean;
}

/**
 * Bottom control bar for voice/video channels.
 * Discord-style rounded buttons with active/inactive states.
 */
export function VoiceControls({
  showVideo = false,
  onSettingsClick,
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

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-3 bg-panel/80 backdrop-blur-sm">
      {/* Listen Together — music button */}
      <ControlButton
        onClick={togglePicker}
        active={pickerOpen}
        icon={<Music size={18} />}
        label={ltActive ? "Music (session active)" : "Listen Together"}
        accent={ltActive}
      />

      {/* Video toggle (only for video channels + VIDEO permission) */}
      {showVideo && canVideo && (
        <ControlButton
          onClick={toggleVideo}
          active={localState.videoEnabled}
          icon={localState.videoEnabled ? <Video size={18} /> : <VideoOff size={18} />}
          label={localState.videoEnabled ? "Turn off camera" : "Turn on camera"}
          danger={!localState.videoEnabled}
        />
      )}

      {/* Screen share (requires SCREEN_SHARE permission) */}
      {canScreenShare && (
        <ControlButton
          onClick={toggleScreenShare}
          active={localState.screenSharing}
          icon={<Monitor size={18} />}
          label={localState.screenSharing ? "Stop sharing" : "Share screen"}
          accent={localState.screenSharing}
        />
      )}

      {/* Mute (requires SPEAK permission to unmute) */}
      <ControlButton
        onClick={toggleMute}
        active={!localState.muted}
        icon={localState.muted ? <MicOff size={18} /> : <Mic size={18} />}
        label={localState.muted ? (canSpeak ? "Unmute" : "No speak permission") : "Mute"}
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
          className="rounded-full p-2.5 text-soft hover:bg-card-hover hover:text-heading transition-colors"
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
          ? "bg-primary/15 text-primary hover:bg-primary/25"
          : danger
            ? "bg-red-500/12 text-red-500 hover:bg-red-500/20"
            : active
              ? "bg-card-hover text-heading hover:bg-border-light"
              : "bg-card-hover text-soft hover:bg-border-light hover:text-heading",
      )}
      title={label}
    >
      {icon}
    </button>
  );
}
