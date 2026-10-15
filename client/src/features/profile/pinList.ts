import type { NostrEvent } from "@/types/nostr";
import { EVENT_KINDS } from "@/types/nostr";

/**
 * The NIP-51 pin list (kind:10001) as data — no IO.
 *
 * Items are `e` tags, appended as they're pinned (NIP-51 keeps list order
 * chronological), so the last tag is the newest pin. Other clients write
 * the same list (the mobile app, Amethyst, Coracle, noStrudel, Snort…) and
 * some add relay hints, `a` tags or an encrypted private half in `content`:
 * a rewrite here keeps everything it doesn't touch, verbatim.
 */

export const PIN_LIST_KIND = EVENT_KINDS.PINNED_NOTES;

/** Pins shown on a profile before "Show all". */
export const PINNED_PREVIEW = 3;

const HEX64 = /^[0-9a-f]{64}$/;

export interface PinOp {
  id: string;
  pin: boolean;
}

/** A list tag → the pinned event id; null for anything that isn't a note pin. */
export function pinnedIdFromTag(tag: readonly string[]): string | null {
  if (tag[0] !== "e" || typeof tag[1] !== "string") return null;
  const id = tag[1].toLowerCase();
  return HEX64.test(id) ? id : null;
}

/** Pinned ids in list order (oldest pin first), deduped. */
export function pinnedIdsFromTags(tags: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const id = pinnedIdFromTag(tag);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** NIP-01 replaceable order: larger created_at wins, a tie goes to the lower id. */
export function isNewerEvent(a: NostrEvent, b: NostrEvent): boolean {
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

/** The newest of two copies (either may be absent). */
export function newerOf(a: NostrEvent | null, b: NostrEvent | null): NostrEvent | null {
  if (!a) return b;
  if (!b) return a;
  return isNewerEvent(a, b) ? a : b;
}

/** `ops` applied in order to a list's tags. A pin appends `["e", id, hint]`
 *  unless the list already holds it (its tag, hint and place stay); an unpin
 *  drops every `e` tag for the id. Nothing else changes. */
export function applyPinOps(
  tags: readonly string[][],
  ops: readonly PinOp[],
  relayHint?: string,
): string[][] {
  let out = tags.map((tag) => [...tag]);
  for (const op of ops) {
    const has = out.some((tag) => pinnedIdFromTag(tag) === op.id);
    if (op.pin && !has) {
      out.push(relayHint ? ["e", op.id, relayHint] : ["e", op.id]);
    } else if (!op.pin && has) {
      out = out.filter((tag) => pinnedIdFromTag(tag) !== op.id);
    }
  }
  return out;
}

export function sameTags(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return (
    a.length === b.length &&
    a.every((tag, i) => tag.length === b[i].length && tag.every((v, j) => v === b[i][j]))
  );
}
