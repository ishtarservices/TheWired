import { useEffect, useRef, useMemo } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";

const BATCH_LIMIT = 100;

/** Batch subscribe for reactions, reposts, and reply counts for visible notes */
export function useNoteEngagementSub(noteEventIds: string[], relayUrl: string | undefined) {
  // Stabilize the ID key so the effect only fires when content actually changes
  const idsKey = useMemo(
    () => noteEventIds.slice(0, BATCH_LIMIT).join(","),
    [noteEventIds],
  );

  const prevIdsRef = useRef<string>("");

  useEffect(() => {
    if (!relayUrl || !idsKey) return;

    // Only re-subscribe if the ID set actually changed
    if (idsKey === prevIdsRef.current) return;
    prevIdsRef.current = idsKey;

    const ids = idsKey.split(",");
    const subIds: string[] = [];

    // Reactions (kind:7)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [7], "#e": ids }],
        relayUrls: [relayUrl],
      }),
    );

    // Reposts (kind:6)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [6], "#e": ids }],
        relayUrls: [relayUrl],
      }),
    );

    // Replies (kind:1 referencing these notes)
    subIds.push(
      subscriptionManager.subscribe({
        filters: [{ kinds: [1], "#e": ids }],
        relayUrls: [relayUrl],
      }),
    );

    return () => {
      for (const id of subIds) {
        subscriptionManager.close(id);
      }
      prevIdsRef.current = "";
    };
  }, [idsKey, relayUrl]);
}
