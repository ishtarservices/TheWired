import { useCallback, useState } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { addEvent, indexChatMessage, hideMessage, removeChatMessage, indexEditedMessage } from "../../store/slices/eventsSlice";
import { selectChatMessages } from "./chatSelectors";
import { parseChannelIdPart } from "../spaces/spaceSelectors";
import { buildChatMessage, buildDeletionEvent, buildModDeletionEvent, buildChatEditEvent, type AttachmentMeta } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { saveUserState, getUserState } from "../../lib/db/userStateStore";
import type { NostrEvent } from "../../types/nostr";

/** 15 minutes in seconds */
const EDIT_WINDOW_SECONDS = 15 * 60;

/** Pending optimistic messages */
interface PendingMessage {
  tempId: string;
  content: string;
  status: "pending" | "confirmed" | "failed";
}

export function useChat() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const messages = useAppSelector(selectChatMessages);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<{
    eventId: string;
    pubkey: string;
  } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ event: NostrEvent; displayContent: string } | null>(null);

  const sendMessage = useCallback(
    async (content: string, mentionPubkeys?: string[], attachments?: AttachmentMeta[], emojiTags?: string[][]) => {
      if (!pubkey || !activeSpaceId || !content.trim()) return;

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // Optimistic: show immediately
      setPendingMessages((prev) => [
        ...prev,
        { tempId, content, status: "pending" },
      ]);

      try {
        // Extract the channel-specific ID (after the "spaceId:" prefix)
        const channelIdPart = parseChannelIdPart(activeChannelId) || undefined;

        const unsigned = buildChatMessage(
          pubkey,
          activeSpaceId,
          content,
          replyTo ?? undefined,
          channelIdPart,
          attachments,
          emojiTags,
        );

        // Add p-tags for mentioned pubkeys
        if (mentionPubkeys && mentionPubkeys.length > 0) {
          const existingPTags = new Set(
            unsigned.tags.filter((t) => t[0] === "p").map((t) => t[1]),
          );
          for (const pk of mentionPubkeys) {
            if (!existingPTags.has(pk)) {
              unsigned.tags.push(["p", pk]);
            }
          }
        }

        const signed = await signAndPublish(unsigned);

        // Add to store — index by channel composite key for per-channel scoping
        dispatch(addEvent(signed));
        dispatch(
          indexChatMessage({ groupId: activeChannelId ?? activeSpaceId, eventId: signed.id }),
        );

        // Remove pending, mark as confirmed
        setPendingMessages((prev) =>
          prev.filter((m) => m.tempId !== tempId),
        );
      } catch {
        // Mark as failed
        setPendingMessages((prev) =>
          prev.map((m) =>
            m.tempId === tempId ? { ...m, status: "failed" } : m,
          ),
        );
      }

      setReplyTo(null);
    },
    [pubkey, activeSpaceId, activeChannelId, replyTo, dispatch],
  );

  const retryMessage = useCallback(
    async (tempId: string) => {
      const msg = pendingMessages.find((m) => m.tempId === tempId);
      if (!msg) return;

      setPendingMessages((prev) =>
        prev.filter((m) => m.tempId !== tempId),
      );
      await sendMessage(msg.content);
    },
    [pendingMessages, sendMessage],
  );

  /** Hide a message locally (delete for me) */
  const deleteMessageForMe = useCallback(
    async (eventId: string) => {
      dispatch(hideMessage(eventId));
      // Persist to IndexedDB
      const existing = await getUserState<Record<string, true>>("deletedMessageIds") ?? {};
      existing[eventId] = true;
      await saveUserState("deletedMessageIds", existing);
    },
    [dispatch],
  );

  /** Publish a kind:5 deletion event (delete for everyone) */
  const deleteMessageForEveryone = useCallback(
    async (eventId: string) => {
      if (!pubkey || !activeSpaceId) return;
      const unsigned = buildDeletionEvent(
        pubkey,
        { eventIds: [eventId] },
        undefined,
        ["9"],
      );
      // Add h-tag so the deletion event matches the space's subscription filter
      unsigned.tags.push(["h", activeSpaceId]);
      await signAndPublish(unsigned);
      // Also hide locally
      dispatch(hideMessage(eventId));
      if (activeChannelId) {
        dispatch(removeChatMessage({ contextId: activeChannelId, eventId }));
      }
    },
    [pubkey, activeSpaceId, dispatch, activeChannelId],
  );

  /** Publish a kind:9005 moderator deletion event */
  const modDeleteMessage = useCallback(
    async (eventId: string) => {
      if (!pubkey || !activeSpaceId) return;
      const unsigned = buildModDeletionEvent(pubkey, activeSpaceId, [eventId]);
      await signAndPublish(unsigned);
      // Also hide locally
      dispatch(hideMessage(eventId));
      if (activeChannelId) {
        dispatch(removeChatMessage({ contextId: activeChannelId, eventId }));
      }
    },
    [pubkey, activeSpaceId, dispatch, activeChannelId],
  );

  /** Edit a chat message (within 15-min window) */
  const editMessage = useCallback(
    async (originalEvent: NostrEvent, newContent: string) => {
      if (!pubkey || !activeSpaceId) return;

      // Client-enforced 15-minute edit window
      const age = Math.floor(Date.now() / 1000) - originalEvent.created_at;
      if (age > EDIT_WINDOW_SECONDS) return;

      const channelIdPart = parseChannelIdPart(activeChannelId) || undefined;
      const unsigned = buildChatEditEvent(
        pubkey,
        activeSpaceId,
        originalEvent.id,
        newContent,
        channelIdPart,
      );

      const signed = await signAndPublish(unsigned);
      dispatch(addEvent(signed));
      dispatch(indexEditedMessage({ originalId: originalEvent.id, editEventId: signed.id }));
      setEditingMessage(null);
    },
    [pubkey, activeSpaceId, activeChannelId, dispatch],
  );

  /** Check if an event is within the edit window */
  const canEdit = useCallback(
    (event: NostrEvent) => {
      if (event.pubkey !== pubkey) return false;
      const age = Math.floor(Date.now() / 1000) - event.created_at;
      return age <= EDIT_WINDOW_SECONDS;
    },
    [pubkey],
  );

  return {
    messages,
    pendingMessages,
    replyTo,
    setReplyTo,
    sendMessage,
    retryMessage,
    editingMessage,
    setEditingMessage,
    deleteMessageForMe,
    deleteMessageForEveryone,
    modDeleteMessage,
    editMessage,
    canEdit,
  };
}
