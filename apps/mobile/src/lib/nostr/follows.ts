// Kind-3 follow-list parsing (read-only — no publish path in this pass).

import type { NostrEvent } from "@thewired/shared-types";

/** NIP-02 follow list (shared-types stays type-only in the mobile bundle). */
const KIND_FOLLOW_LIST = 3;

const HEX64 = /^[0-9a-f]{64}$/;

export interface ParsedFollowList {
  /** Followed pubkeys, p-tag order preserved, deduped. */
  pubkeys: string[];
  listCreatedAt: number;
}

/**
 * Kind-3 is replaceable; relays may return several versions — the latest
 * created_at wins. Returns null when no kind-3 event is present (distinct
 * from an existing-but-empty list, which is "ready with 0 follows").
 */
export function parseFollowList(events: NostrEvent[]): ParsedFollowList | null {
  let latest: NostrEvent | null = null;
  for (const event of events) {
    if (event.kind !== KIND_FOLLOW_LIST) continue;
    if (!latest || event.created_at > latest.created_at) latest = event;
  }
  if (!latest) return null;

  const seen = new Set<string>();
  const pubkeys: string[] = [];
  for (const tag of latest.tags) {
    if (tag[0] !== "p" || typeof tag[1] !== "string") continue;
    const pk = tag[1].toLowerCase();
    if (!HEX64.test(pk) || seen.has(pk)) continue;
    seen.add(pk);
    pubkeys.push(pk);
  }
  return { pubkeys, listCreatedAt: latest.created_at };
}
