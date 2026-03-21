import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { Mic, MicOff, Hand, Monitor } from "lucide-react";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import type { VoiceParticipant as VoiceParticipantType } from "@/types/calling";

interface ParticipantTileProps {
  participant: VoiceParticipantType;
  /** Whether this is the local user */
  isLocal?: boolean;
  /** Show as small compact tile (sidebar) */
  compact?: boolean;
}

/**
 * Renders a participant tile with real video from LiveKit when available,
 * or a styled avatar fallback. Name label overlays the bottom.
 */
export function ParticipantTile({ participant, isLocal, compact }: ParticipantTileProps) {
  const { profile } = useProfile(participant.pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? participant.displayName;
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach/detach LiveKit video track to the DOM element
  useEffect(() => {
    const room = getLivekitRoom();
    if (!room || !videoRef.current) return;

    const lkParticipant = isLocal
      ? room.localParticipant
      : room.remoteParticipants.get(participant.pubkey);

    if (!lkParticipant) return;

    const cameraPub = lkParticipant.getTrackPublication(Track.Source.Camera);
    const track = cameraPub?.track;

    if (track) {
      track.attach(videoRef.current);
    }

    return () => {
      if (track && videoRef.current) {
        track.detach(videoRef.current);
      }
    };
  }, [participant.pubkey, participant.hasVideo, isLocal]);

  const hasVideo = participant.hasVideo;

  return (
    <div
      className={cn(
        "relative overflow-hidden flex items-center justify-center",
        compact
          ? "rounded-lg aspect-video"
          : "rounded-2xl aspect-video",
        participant.isSpeaking
          ? "ring-2 ring-green-400/70"
          : "ring-1 ring-edge/30",
        !hasVideo && "bg-card",
      )}
    >
      {/* Video layer */}
      {hasVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            isLocal && "scale-x-[-1]",
          )}
        />
      )}

      {/* Avatar fallback (shown when no video) */}
      {!hasVideo && (
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Avatar
              src={profile?.picture}
              alt={displayName}
              size={compact ? "sm" : "lg"}
            />
            {participant.isSpeaking && (
              <div className="absolute -inset-1 rounded-full ring-2 ring-green-400 animate-pulse" />
            )}
          </div>
        </div>
      )}

      {/* Bottom overlay: name + status */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
        <span className={cn(
          "truncate font-medium text-white",
          compact ? "text-[10px]" : "text-xs",
        )}>
          {displayName}{isLocal ? " (You)" : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {participant.handRaised && <Hand size={10} className="text-amber-400" />}
          {participant.isScreenSharing && <Monitor size={10} className="text-blue-400" />}
          {participant.isMuted ? (
            <MicOff size={compact ? 9 : 11} className="text-red-400" />
          ) : participant.isSpeaking ? (
            <Mic size={compact ? 9 : 11} className="text-green-400" />
          ) : null}
        </span>
      </div>
    </div>
  );
}
