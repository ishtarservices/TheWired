import { useEffect, useRef } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";

/** Max note IDs to subscribe engagement for at once */
const BATCH_LIMIT = 20;
/** Cap engagement results per kind to prevent relay flooding */
const ENGAGEMENT_LIMIT = 200;

/** Subscribe for reactions, reposts, and reply counts for visible notes on profile.
 *  Caps both the number of note IDs and the result limit per kind. */
export function useProfileEngagementSub(noteEventIds: string[]) {
  const prevIdsRef = useRef<string>("");

  useEffect(() => {
    if (noteEventIds.length === 0) return;

    const ids = noteEventIds.slice(0, BATCH_LIMIT);
    const idsKey = ids.join(",");
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;

    const subIds: string[] = [];

    // Reactions (kind:7) — capped
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [7], "#e": ids, limit: ENGAGEMENT_LIMIT }],
      }),
    );

    // Reposts (kind:6) — capped
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [6], "#e": ids, limit: ENGAGEMENT_LIMIT }],
      }),
    );

    // Replies (kind:1 referencing these notes) — capped
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [1], "#e": ids, limit: ENGAGEMENT_LIMIT }],
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
