import { useEffect, useRef } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { EVENT_KINDS } from "@/types/nostr";

/** Subscribe to emoji sets relevant to the current user and space */
export function useEmojiSets(spaceId?: string | null) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const dispatch = useAppDispatch();
  const subIdsRef = useRef<string[]>([]);

  // Subscribe to user's own emoji list + sets
  useEffect(() => {
    if (!pubkey) return;

    const subId = subscriptionManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.USER_EMOJI_LIST, EVENT_KINDS.EMOJI_SET],
          authors: [pubkey],
        },
      ],
    });

    // The event pipeline handles dispatching — emoji events are indexed
    // via indexEvent in eventPipeline.ts (kind:30030 and kind:10030 cases).
    subIdsRef.current.push(subId);

    return () => {
      subscriptionManager.close(subId);
      subIdsRef.current = subIdsRef.current.filter((id) => id !== subId);
    };
  }, [pubkey, dispatch]);

  // Subscribe to space-scoped emoji sets
  useEffect(() => {
    if (!spaceId) return;

    const subId = subscriptionManager.subscribe({
      filters: [
        {
          kinds: [EVENT_KINDS.EMOJI_SET],
          "#h": [spaceId],
        },
      ],
    });

    subIdsRef.current.push(subId);

    return () => {
      subscriptionManager.close(subId);
      subIdsRef.current = subIdsRef.current.filter((id) => id !== subId);
    };
  }, [spaceId, dispatch]);
}
