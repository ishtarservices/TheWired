import { useMemo } from "react";
import { ParticipantTile } from "./ParticipantTile";
import type { VoiceParticipant as VoiceParticipantType } from "@/types/calling";
import { useAppSelector } from "@/store/hooks";

interface VideoGridProps {
  participants: VoiceParticipantType[];
  /** Include the local participant tile */
  showLocal?: boolean;
}

/**
 * Adaptive grid layout for voice/video channel participants.
 * Renders real video when available, avatar fallback otherwise.
 * Grid columns adapt based on participant count (Discord-style).
 */
export function VideoGrid({ participants, showLocal = true }: VideoGridProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const localState = useAppSelector((s) => s.voice.localState);

  // Build tile list: local user + remote participants
  const tiles = useMemo(() => {
    const list: Array<{ participant: VoiceParticipantType; isLocal: boolean }> = [];

    // Add local participant first
    if (showLocal && myPubkey) {
      list.push({
        participant: {
          pubkey: myPubkey,
          displayName: "You",
          isSpeaking: false,
          isMuted: localState.muted,
          isDeafened: localState.deafened,
          hasVideo: localState.videoEnabled,
          isScreenSharing: localState.screenSharing,
          connectionQuality: "good",
          handRaised: false,
          audioLevel: 0,
        },
        isLocal: true,
      });
    }

    // Add remote participants
    for (const p of participants) {
      list.push({ participant: p, isLocal: false });
    }

    return list;
  }, [participants, myPubkey, localState, showLocal]);

  const gridClass = useMemo(() => {
    const count = tiles.length;
    if (count <= 1) return "grid-cols-1 max-w-2xl mx-auto";
    if (count <= 2) return "grid-cols-2 max-w-4xl mx-auto";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-3";
    if (count <= 9) return "grid-cols-3";
    if (count <= 16) return "grid-cols-4";
    return "grid-cols-5";
  }, [tiles.length]);

  return (
    <div className={`grid ${gridClass} gap-2 h-full auto-rows-fr p-1`}>
      {tiles.map(({ participant, isLocal }) => (
        <ParticipantTile
          key={participant.pubkey}
          participant={participant}
          isLocal={isLocal}
        />
      ))}
    </div>
  );
}
