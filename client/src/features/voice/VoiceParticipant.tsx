import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { Mic, MicOff, Hand, Monitor, Video, Signal, SignalLow, SignalZero } from "lucide-react";
import type { VoiceParticipant as VoiceParticipantType } from "@/types/calling";

interface VoiceParticipantProps {
  participant: VoiceParticipantType;
  compact?: boolean;
}

export function VoiceParticipant({ participant, compact }: VoiceParticipantProps) {
  const { profile } = useProfile(participant.pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? participant.displayName;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-2 py-1">
        <div className="relative">
          <Avatar src={profile?.picture} alt={displayName} size="xs" />
          {participant.isSpeaking && (
            <div className="absolute -inset-0.5 rounded-full ring-2 ring-green-400 animate-pulse" />
          )}
        </div>
        <span
          className={cn(
            "text-xs truncate",
            participant.isSpeaking ? "text-heading font-medium" : "text-soft",
          )}
        >
          {displayName}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {participant.handRaised && <Hand size={10} className="text-amber-400" />}
          {participant.isScreenSharing && <Monitor size={10} className="text-blue-400" />}
          {participant.isMuted ? (
            <MicOff size={10} className="text-red-400" />
          ) : (
            <Mic size={10} className="text-green-400" />
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-2xl p-4 transition-all",
        participant.isSpeaking
          ? "bg-green-500/10 ring-2 ring-green-400/50"
          : "bg-surface/50",
      )}
    >
      <div className="relative">
        <Avatar
          src={profile?.picture}
          alt={displayName}
          size="lg"
        />
        {participant.isSpeaking && (
          <div className="absolute -inset-1 rounded-full ring-2 ring-green-400 animate-pulse" />
        )}
        {participant.isMuted && (
          <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
            <MicOff size={10} className="text-white" />
          </div>
        )}
        {participant.handRaised && (
          <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500">
            <Hand size={10} className="text-white" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-heading truncate max-w-24">
          {displayName}
        </span>
        <QualityIndicator quality={participant.connectionQuality} />
      </div>

      <div className="flex items-center gap-1.5">
        {participant.hasVideo && <Video size={12} className="text-blue-400" />}
        {participant.isScreenSharing && <Monitor size={12} className="text-blue-400" />}
      </div>
    </div>
  );
}

function QualityIndicator({ quality }: { quality: string }) {
  switch (quality) {
    case "excellent":
      return <Signal size={10} className="text-green-400" />;
    case "good":
      return <Signal size={10} className="text-yellow-400" />;
    case "poor":
      return <SignalLow size={10} className="text-red-400" />;
    default:
      return <SignalZero size={10} className="text-muted" />;
  }
}
