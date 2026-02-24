import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";

/** Get events for the active channel */
export function useChannelEvents(channelType: string) {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const events = useAppSelector((s) => s.events);

  return useMemo(() => {
    if (!activeSpaceId) return [];

    let eventIds: string[] = [];

    switch (channelType) {
      case "chat":
        eventIds = events.chatMessages[activeSpaceId] ?? [];
        break;
      case "reels":
        eventIds = events.reels[activeSpaceId] ?? [];
        break;
      case "long-form":
        eventIds = events.longform[activeSpaceId] ?? [];
        break;
      case "live":
        eventIds = events.liveStreams[activeSpaceId] ?? [];
        break;
    }

    return eventIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter(Boolean);
  }, [activeSpaceId, channelType, events]);
}
