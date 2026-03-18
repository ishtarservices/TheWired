import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import type { NostrEvent } from "../../types/nostr";

const EMPTY: string[] = [];

/** Get events for the active channel by selecting only the specific index */
export function useChannelEvents(channelType: string) {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);

  // Select only the specific index array -- NOT the entire events slice
  const eventIds = useAppSelector((s) => {
    if (!activeSpaceId) return EMPTY;
    switch (channelType) {
      case "chat":
        return s.events.chatMessages[activeSpaceId] ?? EMPTY;
      case "reels":
        return s.events.reels[activeSpaceId] ?? EMPTY;
      case "long-form":
        return s.events.longform[activeSpaceId] ?? EMPTY;
      case "live":
        return s.events.liveStreams[activeSpaceId] ?? EMPTY;
      default:
        return EMPTY;
    }
  });

  const entities = useAppSelector((s) => s.events.entities);

  return useMemo(
    () =>
      eventIds
        .map((id) => entities[id])
        .filter((e): e is NostrEvent => !!e),
    [eventIds, entities],
  );
}
