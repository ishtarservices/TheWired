import { useCallback, useState } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { addEvent, indexChatMessage } from "../../store/slices/eventsSlice";
import { selectChatMessages } from "./chatSelectors";
import { buildChatMessage } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";


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
  const messages = useAppSelector(selectChatMessages);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<{
    eventId: string;
    pubkey: string;
  } | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!pubkey || !activeSpaceId || !content.trim()) return;

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      // Optimistic: show immediately
      setPendingMessages((prev) => [
        ...prev,
        { tempId, content, status: "pending" },
      ]);

      try {
        const unsigned = buildChatMessage(
          pubkey,
          activeSpaceId,
          content,
          replyTo ?? undefined,
        );
        const signed = await signAndPublish(unsigned);

        // Add to store
        dispatch(addEvent(signed));
        dispatch(
          indexChatMessage({ groupId: activeSpaceId, eventId: signed.id }),
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
    [pubkey, activeSpaceId, replyTo, dispatch],
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

  return {
    messages,
    pendingMessages,
    replyTo,
    setReplyTo,
    sendMessage,
    retryMessage,
  };
}
