import { useEffect, useRef } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";

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

    // Single sub with multiple filters — same events, fewer REQ messages per relay.
    // NIP-01: multiple filters in one REQ are OR'd; relay can deduplicate across them.
    const subId = subscriptionManager.subscribe({
      filters: [
        { kinds: [7], "#e": ids, limit: ENGAGEMENT_LIMIT },
        { kinds: [6], "#e": ids, limit: ENGAGEMENT_LIMIT },
        { kinds: [1], "#e": ids, limit: ENGAGEMENT_LIMIT },
      ],
      relayUrls: PROFILE_RELAYS,
    });

    return () => {
      subscriptionManager.close(subId);
      prevIdsRef.current = "";
    };
  }, [noteEventIds]);
}
