import { useEffect, useRef, useMemo } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";

const BATCH_LIMIT = 100;

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

  const prevIdsRef = useRef<string>("");

  useEffect(() => {
    if (!idsKey) return;

    // Only re-subscribe if the ID set actually changed
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;

    const ids = idsKey.split(",");
    const subIds: string[] = [];

    // Reactions (kind:7)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [7], "#e": ids }],
        relayUrls,
      }),
    );

    // Reposts (kind:6)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [6], "#e": ids }],
        relayUrls,
      }),
    );

    // Replies (kind:1 referencing these notes)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [1], "#e": ids }],
        relayUrls,
      }),
    );

    return () => {
      for (const id of subIds) {
        subscriptionManager.close(id);
      }
      prevIdsRef.current = "";
    };
  }, [idsKey, relayUrls]);
}
