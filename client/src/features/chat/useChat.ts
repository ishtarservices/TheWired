import { useCallback, useMemo, useState } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { resolveRelaySet } from "../spaces/relaySet";
import { addEvent, indexChatMessage, hideMessage, removeChatMessage, indexEditedMessage } from "../../store/slices/eventsSlice";
import { selectChatMessages } from "./chatSelectors";
import { parseChannelIdPart } from "../spaces/spaceSelectors";
import { buildChatMessage, buildDeletionEvent, buildModDeletionEvent, buildChatEditEvent, buildPollEvent, type AttachmentMeta } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { relayManager } from "../../lib/nostr/relayManager";
import { saveUserState, getUserState } from "../../lib/db/userStateStore";
import { EVENT_KINDS, type NostrEvent } from "../../types/nostr";
import type { PollDraft } from "../polls/PollComposer";

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
  const hostRelay = useAppSelector(
    (s) => s.spaces.list.find((sp) => sp.id === s.spaces.activeSpaceId)?.hostRelay,
  );
  // The space's full relay set (authority + mirrors, M9): publish to all and
  // read from any, so the space survives the authority relay going offline.
  const relayUrlsKey = useAppSelector((s) =>
    (s.spaces.list.find((sp) => sp.id === s.spaces.activeSpaceId)?.relayUrls ?? []).join(","),
  );
  const relayTargets = useMemo(
    () => (hostRelay ? resolveRelaySet({ hostRelay, relayUrls: relayUrlsKey ? relayUrlsKey.split(",") : [] }) : []),
    [hostRelay, relayUrlsKey],
  );
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

        // Ensure every relay in the space's set is in the connection pool —
        // `relayManager.publish` silently drops targets that aren't in
        // `connections`, which would make the publish a no-op for any host that
        // isn't a bootstrap relay or in the user's NIP-65 list. Publish-to-all
        // (M9): the message lands on the authority + every mirror.
        for (const url of relayTargets) {
          relayManager.connect(url, "read+write");
        }

        const signed = await signAndPublish(
          unsigned,
          relayTargets.length ? relayTargets : undefined,
        );

        // Add to store — index by channel composite key for per-channel scoping
        dispatch(addEvent(signed));
        dispatch(
          indexChatMessage({ groupId: activeChannelId ?? activeSpaceId, eventId: signed.id }),
        );

        // Remove pending, mark as confirmed
        setPendingMessages((prev) =>
          prev.filter((m) => m.tempId !== tempId),
        );
      } catch (err) {
        console.error("[chat] sendMessage failed", err);
        // Mark as failed
        setPendingMessages((prev) =>
          prev.map((m) =>
            m.tempId === tempId ? { ...m, status: "failed" } : m,
          ),
        );
      }

      setReplyTo(null);
    },
    [pubkey, activeSpaceId, activeChannelId, replyTo, relayTargets, dispatch],
  );

  /** Publish a NIP-88 poll into the active channel. The local pipeline pass in
   *  signAndPublish indexes it into the chat timeline — no hand-dispatch. */
  const sendPoll = useCallback(
    async (draft: PollDraft) => {
      if (!pubkey || !activeSpaceId) return;

      try {
        const channelIdPart = parseChannelIdPart(activeChannelId) || undefined;
        const unsigned = buildPollEvent(pubkey, draft.question, draft.options, {
          pollType: draft.pollType,
          endsAt: draft.endsAt,
          relays: relayTargets,
          spaceId: activeSpaceId,
          channelId: channelIdPart,
        });

        for (const url of relayTargets) {
          relayManager.connect(url, "read+write");
        }
        await signAndPublish(
          unsigned,
          relayTargets.length ? relayTargets : undefined,
        );
      } catch (err) {
        console.error("[chat] sendPoll failed", err);
      }
    },
    [pubkey, activeSpaceId, activeChannelId, relayTargets],
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
    async (eventId: string, kind: number = EVENT_KINDS.CHAT_MESSAGE) => {
      if (!pubkey || !activeSpaceId) return;
      const unsigned = buildDeletionEvent(
        pubkey,
        { eventIds: [eventId] },
        undefined,
        [String(kind)],
      );
      // Add h-tag so the deletion event matches the space's subscription filter
      unsigned.tags.push(["h", activeSpaceId]);
      await signAndPublish(unsigned, relayTargets.length ? relayTargets : undefined);
      // Also hide locally
      dispatch(hideMessage(eventId));
      if (activeChannelId) {
        dispatch(removeChatMessage({ contextId: activeChannelId, eventId }));
      }
    },
    [pubkey, activeSpaceId, relayTargets, dispatch, activeChannelId],
  );

  /** Publish a kind:9005 moderator deletion event */
  const modDeleteMessage = useCallback(
    async (eventId: string) => {
      if (!pubkey || !activeSpaceId) return;
      const unsigned = buildModDeletionEvent(pubkey, activeSpaceId, [eventId]);
      await signAndPublish(unsigned, relayTargets.length ? relayTargets : undefined);
      // Also hide locally
      dispatch(hideMessage(eventId));
      if (activeChannelId) {
        dispatch(removeChatMessage({ contextId: activeChannelId, eventId }));
      }
    },
    [pubkey, activeSpaceId, relayTargets, dispatch, activeChannelId],
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

      const signed = await signAndPublish(unsigned, relayTargets.length ? relayTargets : undefined);
      dispatch(addEvent(signed));
      dispatch(indexEditedMessage({ originalId: originalEvent.id, editEventId: signed.id }));
      setEditingMessage(null);
    },
    [pubkey, activeSpaceId, activeChannelId, relayTargets, dispatch],
  );

  /** Check if an event is within the edit window (chat messages only —
   *  NIP-88 polls have no edit semantics) */
  const canEdit = useCallback(
    (event: NostrEvent) => {
      if (event.kind !== EVENT_KINDS.CHAT_MESSAGE) return false;
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
    sendPoll,
    relayTargets,
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
