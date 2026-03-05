import { useEffect, useRef } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";

const BATCH_LIMIT = 100;

/** Subscribe for reactions, reposts, and reply counts for visible notes on profile.
 *  Uses default read relays (no relayUrl param needed). */
export function useProfileEngagementSub(noteEventIds: string[]) {
  const prevIdsRef = useRef<string>("");

  useEffect(() => {
    if (noteEventIds.length === 0) return;

    const idsKey = noteEventIds.slice(0, BATCH_LIMIT).join(",");
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;

    const ids = noteEventIds.slice(0, BATCH_LIMIT);
    const subIds: string[] = [];

    // Reactions (kind:7)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [7], "#e": ids }],
      }),
    );

    // Reposts (kind:6)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [6], "#e": ids }],
      }),
    );

    // Replies (kind:1 referencing these notes)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [1], "#e": ids }],
      }),
    );

    return () => {
      for (const id of subIds) {
        subscriptionManager.close(id);
      }
      prevIdsRef.current = "";
    };
  }, [noteEventIds]);
}
