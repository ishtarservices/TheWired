import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../store";
import type { NostrEvent } from "../../types/nostr";
import type { SpaceChannel, SpaceChannelType } from "../../types/space";
import { isRootNote } from "./noteParser";

/** Resolve the context ID for a channel type within a space */
export function getContextId(
  spaceId: string,
  channelType: SpaceChannelType,
  channels?: SpaceChannel[],
): string {
  if (channels && channels.length > 0) {
    const channel = channels.find((c) => c.type === channelType);
    if (channel) return `${spaceId}:${channel.id}`;
  }
  // Legacy fallback
  return `${spaceId}:${channelType}`;
}

/** Select event IDs array for a specific space feed context */
const selectSpaceFeedIds = (state: RootState, contextId: string) =>
  state.events.spaceFeeds[contextId] ?? [];

/** Select just the entities map (not the whole events slice) */
const selectEntities = (state: RootState) => state.events.entities;

/**
 * Memoized selector: returns NostrEvent[] for a space feed context.
 * Only recomputes when the specific contextId's event ID array changes
 * or when the entities map changes.
 */
export const selectSpaceFeedEvents = createSelector(
  [selectSpaceFeedIds, selectEntities],
  (eventIds, entities) =>
    eventIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e),
);

/** Memoized: notes for active space, sorted desc */
export const selectSpaceNotes = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events.spaceFeeds,
    selectEntities,
  ],
  (activeSpaceId, spaceFeeds, entities) => {
    if (!activeSpaceId) return [];
    const ids = spaceFeeds[`${activeSpaceId}:notes`] ?? [];
    return ids
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => b.created_at - a.created_at);
  },
);

/** Memoized: root notes only (no replies) for active space, sorted desc */
export const selectSpaceRootNotes = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events.spaceFeeds,
    selectEntities,
  ],
  (activeSpaceId, spaceFeeds, entities) => {
    if (!activeSpaceId) return [];
    const ids = spaceFeeds[`${activeSpaceId}:notes`] ?? [];
    return ids
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .filter(isRootNote)
      .sort((a, b) => b.created_at - a.created_at);
  },
);

/** Memoized: just the IDs of root notes (for engagement subscription) */
export const selectSpaceRootNoteIds = createSelector(
  [selectSpaceRootNotes],
  (notes) => notes.map((n) => n.id),
);

/** Memoized: media event IDs for active space (unsorted -- caller sorts) */
export const selectSpaceMediaEvents = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events.spaceFeeds,
    selectEntities,
  ],
  (activeSpaceId, spaceFeeds, entities) => {
    if (!activeSpaceId) return [];
    const ids = spaceFeeds[`${activeSpaceId}:media`] ?? [];
    return ids
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e);
  },
);

/** Memoized: articles for active space */
export const selectSpaceArticles = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events.spaceFeeds,
    (state: RootState) => state.events.longform,
    selectEntities,
  ],
  (activeSpaceId, spaceFeeds, longform, entities) => {
    if (!activeSpaceId) return [];
    // Articles may be in spaceFeeds or longform index
    const spaceFeedIds = spaceFeeds[`${activeSpaceId}:articles`] ?? [];
    const longformIds = longform[activeSpaceId] ?? [];
    // Merge and deduplicate
    const allIds = [...new Set([...spaceFeedIds, ...longformIds])];
    return allIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e);
  },
);
