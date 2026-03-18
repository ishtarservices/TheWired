import { useAppSelector } from "../../store/hooks";
import {
  selectSpaceNotes,
  selectSpaceMediaEvents,
  selectSpaceArticles,
  selectSpaceFeedEvents,
} from "./spaceSelectors";
import type { RootState } from "../../store";
import type { NostrEvent } from "../../types/nostr";
import type { SpaceChannelType } from "../../types/space";

/** Map channel types to their memoized selectors */
const CHANNEL_SELECTORS: Record<string, (state: RootState) => NostrEvent[]> = {
  notes: selectSpaceNotes,
  media: selectSpaceMediaEvents,
  articles: selectSpaceArticles,
};

/**
 * Get events for a space feed channel (notes, media, articles).
 * Uses memoized selectors so it only recomputes when the specific
 * feed index or entities change -- NOT on every event in the app.
 */
export function useSpaceFeed(channelType: SpaceChannelType) {
  const selector = CHANNEL_SELECTORS[channelType];

  // For known channel types use the memoized selector directly.
  // For unknown types fall back to the generic context-based selector.
  return useAppSelector((state) => {
    if (selector) return selector(state);

    const activeSpaceId = state.spaces.activeSpaceId;
    if (!activeSpaceId) return [];
    const contextId = `${activeSpaceId}:${channelType}`;
    return selectSpaceFeedEvents(state, contextId);
  });
}
