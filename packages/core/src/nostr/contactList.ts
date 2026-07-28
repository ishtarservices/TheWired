import type { UnsignedEvent } from "@thewired/shared-types";

/** Build an unsigned kind:3 follow list event (NIP-02).
 *
 *  Throws if the follow list is empty — publishing an empty kind:3
 *  permanently wipes the user's contact list on all relays. This is the
 *  builder-level half of the wipe guard; callers (follow/unfollow) hold the
 *  other half (refusing when the current list looks unloaded). */
export function buildFollowListEvent(
  pubkey: string,
  follows: string[],
): UnsignedEvent {
  if (follows.length === 0) {
    throw new Error(
      "Refusing to build kind:3 with empty follow list — this would wipe the user's contacts on all relays",
    );
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    tags: follows.map((pk) => ["p", pk]),
    content: "",
  };
}

/** Pure add: returns a new list with `pubkey` appended if absent (idempotent). */
export function applyFollow(follows: string[], pubkey: string): string[] {
  if (follows.includes(pubkey)) return follows;
  return [...follows, pubkey];
}

/** Pure remove: returns a new list with `pubkey` filtered out (idempotent). */
export function applyUnfollow(follows: string[], pubkey: string): string[] {
  if (!follows.includes(pubkey)) return follows;
  return follows.filter((pk) => pk !== pubkey);
}
