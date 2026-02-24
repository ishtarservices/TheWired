import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";
import type { SpaceChannelType } from "../../types/space";

/** Get events for a space feed channel (notes, media, articles) */
export function useSpaceFeed(channelType: SpaceChannelType) {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const events = useAppSelector((s) => s.events);

  return useMemo(() => {
    if (!activeSpaceId) return [];

    const contextId = `${activeSpaceId}:${channelType}`;
    const eventIds = events.spaceFeeds[contextId] ?? [];

    return eventIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e);
  }, [activeSpaceId, channelType, events]);
}
