import { useEffect, useMemo } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";

const BATCH_LIMIT = 100;
/** Wait for the visible-note set to settle before issuing one REQ. Notes stream
 *  in from relays one-by-one, so `noteEventIds` grows incrementally — without this
 *  the feed fired one engagement sub per note as it arrived (#e=1, #e=2, … #e=N),
 *  churning through dozens of REQs and tripping relay subscription caps. */
const ENGAGEMENT_DEBOUNCE_MS = 300;

/**
 * Batch subscribe for reactions, reposts, and reply counts for visible notes.
 * Pass `relayUrls: undefined` to use all read relays (for Friends Feed / read-only spaces).
 * Pass `relayUrls: [url]` for a specific host relay (community spaces).
 */
export function useNoteEngagementSub(noteEventIds: string[], relayUrls: string[] | undefined) {
  // Stabilize the ID key so the effect only fires when content actually changes
  const idsKey = useMemo(
    () => noteEventIds.slice(0, BATCH_LIMIT).join(","),
    [noteEventIds],
  );

  useEffect(() => {
    if (!idsKey) return;

    let subId: string | null = null;
    const timer = setTimeout(() => {
      const ids = idsKey.split(",");
      // Single sub with multiple filters — same events, fewer REQ messages per relay.
      subId = subscriptionManager.subscribe({
        filters: [
          { kinds: [7], "#e": ids },
          { kinds: [6], "#e": ids },
          { kinds: [1], "#e": ids },
          { kinds: [9735], "#e": ids },
        ],
        relayUrls,
      });
    }, ENGAGEMENT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      if (subId) subscriptionManager.close(subId);
    };
  }, [idsKey, relayUrls]);
}
