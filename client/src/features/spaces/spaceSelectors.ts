import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../store";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";

/** Select event IDs array for a specific space feed context */
const selectSpaceFeedIds = (state: RootState, contextId: string) =>
  state.events.spaceFeeds[contextId] ?? [];

/** Select the events entity state */
const selectEventsEntity = (state: RootState) => state.events;

/**
 * Memoized selector: returns NostrEvent[] for a space feed context.
 * Only recomputes when the specific contextId's event ID array changes
 * or when the entities map changes.
 */
export const selectSpaceFeedEvents = createSelector(
  [selectSpaceFeedIds, selectEventsEntity],
  (eventIds, events) =>
    eventIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e),
);

/** Memoized: notes for active space, sorted desc */
export const selectSpaceNotes = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    selectEventsEntity,
  ],
  (activeSpaceId, events) => {
    if (!activeSpaceId) return [];
    const ids = events.spaceFeeds[`${activeSpaceId}:notes`] ?? [];
    return ids
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => b.created_at - a.created_at);
  },
);

/** Memoized: media event IDs for active space (unsorted -- caller sorts) */
export const selectSpaceMediaEvents = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    selectEventsEntity,
  ],
  (activeSpaceId, events) => {
    if (!activeSpaceId) return [];
    const ids = events.spaceFeeds[`${activeSpaceId}:media`] ?? [];
    return ids
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e);
  },
);

/** Memoized: articles for active space */
export const selectSpaceArticles = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    selectEventsEntity,
  ],
  (activeSpaceId, events) => {
    if (!activeSpaceId) return [];
    // Articles may be in spaceFeeds or longform index
    const spaceFeedIds = events.spaceFeeds[`${activeSpaceId}:articles`] ?? [];
    const longformIds = events.longform[activeSpaceId] ?? [];
    // Merge and deduplicate
    const allIds = [...new Set([...spaceFeedIds, ...longformIds])];
    return allIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e);
  },
);
