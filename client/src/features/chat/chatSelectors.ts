import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../store";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";

/** Select chat message events for the active group, sorted by time ascending */
export const selectChatMessages = createSelector(
  [
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events,
  ],
  (activeSpaceId, events) => {
    if (!activeSpaceId) return [];

    const messageIds = events.chatMessages[activeSpaceId] ?? [];
    return messageIds
      .map((id) => eventsSelectors.selectById(events, id))
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => a.created_at - b.created_at);
  },
);

/** Get the reply target from a chat message's q tag */
export function getReplyTarget(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "q")?.[1];
}
