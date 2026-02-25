import { useEffect, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import type { NostrEvent } from "../../types/nostr";

/** Load and select replies for a note, subscribing when expanded */
export function useNoteThread(eventId: string, expanded: boolean) {
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });
  const replyIds = useAppSelector((s) => s.events.replies[eventId]);
  const entities = useAppSelector((s) => s.events.entities);

  // Subscribe for replies when expanded
  useEffect(() => {
    if (!expanded || !activeSpace?.hostRelay) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ kinds: [1], "#e": [eventId], limit: 50 }],
      relayUrls: [activeSpace.hostRelay],
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [expanded, eventId, activeSpace?.hostRelay]);

  const replies = useMemo(() => {
    if (!replyIds || replyIds.length === 0) return [];
    return replyIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => a.created_at - b.created_at);
  }, [replyIds, entities]);

  return { replies, replyCount: replyIds?.length ?? 0 };
}
