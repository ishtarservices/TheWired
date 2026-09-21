import { useEffect, useMemo } from "react";
import { store } from "../../store";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { selectReactionEventIdsFor } from "../../store/slices/reactionsSlice";

const BATCH_LIMIT = 100;
/** Wait for the visible-note set to settle before issuing one REQ. Notes stream
 *  in from relays one-by-one, so `noteEventIds` grows incrementally — without this
 *  the feed fired one engagement sub per note as it arrived (#e=1, #e=2, … #e=N),
 *  churning through dozens of REQs and tripping relay subscription caps. */
const ENGAGEMENT_DEBOUNCE_MS = 300;

/**
 * Build the engagement filters for a batch of note ids: reactions, reposts,
 * replies, zap receipts — plus a kind:5 leg for un-reacts. A kind:5 e-tags the
 * *reaction* id, not the note, so the leg unions the note ids with every
 * reaction id already known for those notes (coverage converges as the
 * subscription re-fires with newly learned reaction ids).
 */
export function buildEngagementFilters(
  noteIds: string[],
  knownReactionIds: string[],
): { kinds: number[]; "#e": string[] }[] {
  const deletionTargets = knownReactionIds.length > 0
    ? [...new Set([...noteIds, ...knownReactionIds])]
    : noteIds;
  return [
    { kinds: [7], "#e": noteIds },
    { kinds: [6], "#e": noteIds },
    { kinds: [1], "#e": noteIds },
    { kinds: [9735], "#e": noteIds },
    { kinds: [5], "#e": deletionTargets },
  ];
}

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
        filters: buildEngagementFilters(
          ids,
          selectReactionEventIdsFor(store.getState(), ids),
        ),
        relayUrls,
      });
    }, ENGAGEMENT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      if (subId) subscriptionManager.close(subId);
    };
  }, [idsKey, relayUrls]);
}
