import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../store";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import type { NostrEvent } from "../../types/nostr";

/** Enriched chat message with edit resolution */
export interface ChatMessageView {
  event: NostrEvent;
  isEdited: boolean;
  displayContent: string;
}

/** Select chat message events for the active channel, sorted by time ascending */
export const selectChatMessages = createSelector(
  [
    (state: RootState) => state.spaces.activeChannelId,
    (state: RootState) => state.spaces.activeSpaceId,
    (state: RootState) => state.events,
  ],
  (activeChannelId, activeSpaceId, events): ChatMessageView[] => {
    if (!activeSpaceId) return [];

    // Prefer channel-scoped messages; fall back to space-level for legacy messages
    const channelMessages = activeChannelId ? events.chatMessages[activeChannelId] : undefined;
    const spaceMessages = events.chatMessages[activeSpaceId];
    const messageIds = channelMessages ?? spaceMessages ?? [];
    return messageIds
      .filter((id) => !events.deletedMessageIds[id])
      .map((id) => {
        const event = eventsSelectors.selectById(events, id);
        if (!event) return null;

        // Resolve edit: check if there's an edit event for this message
        const editEventId = events.editedMessages[event.id];
        const editEvent = editEventId ? eventsSelectors.selectById(events, editEventId) : undefined;

        return {
          event,
          isEdited: !!editEvent,
          displayContent: editEvent?.content ?? event.content,
        };
      })
      .filter((e): e is ChatMessageView => !!e)
      .sort((a, b) => a.event.created_at - b.event.created_at);
  },
);

/** Get the reply target from a chat message's q tag */
export function getReplyTarget(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "q")?.[1];
}
