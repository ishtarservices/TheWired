// NIP-10/25/18 tag targeting. Thread classification is single-sourced from
// @thewired/core (nostr/thread.ts) — the fixed parseThreadRef excludes
// mention-marked e-tags even in the single-tag positional path, so quote
// posts no longer classify as replies. Reaction/repost targeting stays
// local (desktop eventPipeline conventions, not thread logic).

import type { NostrEvent } from "@thewired/shared-types";

export { parseThreadRef, type ThreadRef } from "@thewired/core";

/** Kind-7 reaction target — LAST "e" tag (NIP-25, desktop pipeline parity). */
export function reactionTargetId(event: NostrEvent): string | undefined {
  const eTags = event.tags.filter((t) => t[0] === "e");
  return eTags[eTags.length - 1]?.[1];
}

/** Kind-6 repost target — FIRST "e" tag (desktop pipeline parity). */
export function repostTargetId(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "e")?.[1];
}
