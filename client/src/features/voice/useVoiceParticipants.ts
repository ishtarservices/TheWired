import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { selectVoiceParticipants, selectActiveSpeakers } from "./voiceSelectors";

/**
 * Hook for tracking voice channel participants with speaking state.
 */
export function useVoiceParticipants() {
  const participants = useAppSelector(selectVoiceParticipants);
  const activeSpeakers = useAppSelector(selectActiveSpeakers);

  const participantList = useMemo(() => {
    const activeSpeakerSet = new Set(activeSpeakers);
    return Object.values(participants).map((p) => ({
      ...p,
      isSpeaking: activeSpeakerSet.has(p.pubkey),
    }));
  }, [participants, activeSpeakers]);

  const speakingParticipants = useMemo(
    () => participantList.filter((p) => p.isSpeaking),
    [participantList],
  );

  const sortedParticipants = useMemo(() => {
    return [...participantList].sort((a, b) => {
      // Speaking participants first
      if (a.isSpeaking !== b.isSpeaking) return a.isSpeaking ? -1 : 1;
      // Then by name
      return a.displayName.localeCompare(b.displayName);
    });
  }, [participantList]);

  return {
    participants: participantList,
    sortedParticipants,
    speakingParticipants,
    count: participantList.length,
  };
}
