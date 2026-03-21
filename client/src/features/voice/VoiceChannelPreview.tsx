import { useAppSelector } from "@/store/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { selectIsInChannel, selectVoiceParticipants, selectChannelPresence } from "./voiceSelectors";
import { Volume2 } from "lucide-react";

interface VoiceChannelPreviewProps {
  spaceId: string;
  channelId: string;
}

/**
 * Inline preview of connected users in a voice channel,
 * displayed in the channel list sidebar.
 *
 * When locally connected: shows live participant data from LiveKit.
 * When not connected: shows presence data from API polling.
 */
export function VoiceChannelPreview({ spaceId, channelId }: VoiceChannelPreviewProps) {
  const isConnected = useAppSelector(selectIsInChannel(spaceId, channelId));
  const liveParticipants = useAppSelector(selectVoiceParticipants);
  const channelPresence = useAppSelector(selectChannelPresence(channelId));
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  if (isConnected) {
    // Connected: show local user + live remote participants
    const remoteList = Object.values(liveParticipants);
    return (
      <div className="ml-6 mt-0.5 space-y-0.5">
        {myPubkey && <ParticipantRow pubkey={myPubkey} isSpeaking={false} />}
        {remoteList.map((p) => (
          <ParticipantRow key={p.pubkey} pubkey={p.pubkey} isSpeaking={p.isSpeaking} />
        ))}
      </div>
    );
  }

  // Not connected: show presence from API polling
  if (!channelPresence || channelPresence.participantCount === 0) return null;

  return (
    <div className="ml-6 mt-0.5 space-y-0.5">
      {channelPresence.participants.map((p) => (
        <ParticipantRow key={p.pubkey} pubkey={p.pubkey} isSpeaking={false} />
      ))}
    </div>
  );
}

function ParticipantRow({ pubkey, isSpeaking }: { pubkey: string; isSpeaking: boolean }) {
  const { profile } = useProfile(pubkey);
  const displayName = profile?.name ?? profile?.display_name ?? pubkey.slice(0, 8);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {isSpeaking ? (
        <Volume2 size={10} className="text-green-400 shrink-0" />
      ) : (
        <div className="h-2.5 w-2.5 shrink-0" />
      )}
      <Avatar src={profile?.picture} alt={displayName} size="xs" />
      <span className="text-[11px] text-soft truncate">{displayName}</span>
    </div>
  );
}
