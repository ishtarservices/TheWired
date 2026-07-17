// Peek-reply ranking — pure. Engagement-weighted so the 3 visible rows are
// the conversation's most-substantive openers, chrono ascending among ties
// (which is the common all-zeros case: brand-new threads read in order).

import { compareEventsChrono } from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

/** Sort replies by score desc, chrono asc tiebreak. `scoreOf` is injected so
 *  this stays pure of the store shape. */
export function rankPeekReplies(
  replies: readonly NostrEvent[],
  scoreOf: (id: string) => number,
): NostrEvent[] {
  return [...replies].sort(
    (a, b) => scoreOf(b.id) - scoreOf(a.id) || compareEventsChrono(a, b),
  );
}
