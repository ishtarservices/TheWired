import { useEffect, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { FRIENDS_FEED_ID } from "../friends/friendsFeedConstants";
import type { NostrEvent } from "../../types/nostr";

/** Load and select replies for a note, subscribing when expanded */
export function useNoteThread(eventId: string, expanded: boolean) {
  const activeSpace = useAppSelector((s) => {
    const id = s.spaces.activeSpaceId;
    return id ? s.spaces.list.find((sp) => sp.id === id) : undefined;
  });
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const replyIds = useAppSelector((s) => s.events.replies[eventId]);
  const entities = useAppSelector((s) => s.events.entities);

  // For Friends Feed and read-only spaces, replies live on repliers' relays,
  // not a single host relay — use all read relays (undefined).
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;
  const isReadOnly = activeSpace?.mode === "read";
  const relayUrls =
    isFriendsFeed || isReadOnly
      ? undefined // all read relays
      : activeSpace?.hostRelay
        ? [activeSpace.hostRelay]
        : undefined;

  // Subscribe for replies when expanded
  useEffect(() => {
    if (!expanded) return;
    // For community spaces we need a host relay; Friends Feed / read-only use all relays
    if (!isFriendsFeed && !isReadOnly && !activeSpace?.hostRelay) return;

    const subId = subscriptionManager.subscribe({
      filters: [{ kinds: [1], "#e": [eventId], limit: 50 }],
      relayUrls,
    });

    return () => {
      subscriptionManager.close(subId);
    };
  }, [expanded, eventId, relayUrls, isFriendsFeed, isReadOnly, activeSpace?.hostRelay]);

  const replies = useMemo(() => {
    if (!replyIds || replyIds.length === 0) return [];
    return replyIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e)
      .sort((a, b) => a.created_at - b.created_at);
  }, [replyIds, entities]);

  return { replies, replyCount: replyIds?.length ?? 0 };
}
