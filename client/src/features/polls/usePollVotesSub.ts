import { useEffect, useMemo } from "react";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { EVENT_KINDS } from "../../types/nostr";

const BATCH_LIMIT = 100;
/** Wait for the visible-poll set to settle before issuing one REQ — polls
 *  stream in incrementally, same churn concern as useNoteEngagementSub. */
const VOTES_DEBOUNCE_MS = 300;

/**
 * Batch subscribe for kind:1018 votes on visible polls. A dedicated #e sub
 * (rather than the h-tag channel sub) so cross-client votes without our
 * NIP-29 h tag are counted too.
 * Pass `relayUrls: undefined` to use all read relays; `[url, ...]` for a
 * space's relay set.
 */
export function usePollVotesSub(
  pollEventIds: string[],
  relayUrls: string[] | undefined,
) {
  const idsKey = useMemo(
    () => pollEventIds.slice(0, BATCH_LIMIT).join(","),
    [pollEventIds],
  );

  useEffect(() => {
    if (!idsKey) return;

    let subId: string | null = null;
    const timer = setTimeout(() => {
      const ids = idsKey.split(",");
      subId = subscriptionManager.subscribe({
        filters: [{ kinds: [EVENT_KINDS.POLL_RESPONSE], "#e": ids }],
        relayUrls,
      });
    }, VOTES_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      if (subId) subscriptionManager.close(subId);
    };
  }, [idsKey, relayUrls]);
}
