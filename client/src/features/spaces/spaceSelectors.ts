import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../store";
import type { NostrEvent } from "../../types/nostr";
import type { Space, SpaceChannel, SpaceChannelType } from "../../types/space";

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

/** Extract the channel ID part from a composite "spaceId:channelId" string */
export function parseChannelIdPart(activeChannelId: string | null): string {
  if (!activeChannelId) return "";
  return activeChannelId.split(":").slice(1).join(":");
}

// ── Input selectors (shared across multiple memoized selectors) ──

const selectActiveSpaceId = (state: RootState) => state.spaces.activeSpaceId;
const selectSpaceList = (state: RootState) => state.spaces.list;
const selectSpaceFeeds = (state: RootState) => state.events.spaceFeeds;
const selectEntities = (state: RootState) => state.events.entities;
const selectLongform = (state: RootState) => state.events.longform;

/** Select event IDs array for a specific space feed context */
const selectSpaceFeedIds = (state: RootState, contextId: string) =>
  state.events.spaceFeeds[contextId] ?? [];

// ── Memoized selectors ──

/** Memoized: the currently active Space object (or null) */
export const selectActiveSpace = createSelector(
  [selectActiveSpaceId, selectSpaceList],
  (id, list): Space | null => (id ? list.find((s) => s.id === id) ?? null : null),
);

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
  [selectActiveSpaceId, selectSpaceFeeds, selectEntities],
  (activeSpaceId, spaceFeeds, entities) => {
    if (!activeSpaceId) return [];
    const ids = spaceFeeds[`${activeSpaceId}:notes`] ?? [];
    return ids
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => b.created_at - a.created_at);
  },
);

/** Memoized: root notes only (no replies) for active space, sorted desc.
 *  Composes from selectSpaceNotes to avoid duplicating logic. */
export const selectSpaceRootNotes = createSelector(
  [selectSpaceNotes],
  (notes) => notes.filter((e) => {
    if (e.kind !== 1) return false;
    // A root note has no "e" tags with root/reply markers AND no positional "e" tags
    const eTags = e.tags.filter((t) => t[0] === "e");
    if (eTags.length === 0) return true;
    const rootTag = eTags.find((t) => t[3] === "root");
    const replyTag = eTags.find((t) => t[3] === "reply");
    if (rootTag || replyTag) return false;
    // Deprecated positional: any e-tag means it's a reply
    return false;
  }),
);

/** Memoized: just the IDs of root notes (for engagement subscription) */
export const selectSpaceRootNoteIds = createSelector(
  [selectSpaceRootNotes],
  (notes) => notes.map((n) => n.id),
);

/** Memoized: media events for active space (unsorted -- caller sorts) */
export const selectSpaceMediaEvents = createSelector(
  [selectActiveSpaceId, selectSpaceFeeds, selectEntities],
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
  [selectActiveSpaceId, selectSpaceFeeds, selectLongform, selectEntities],
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
