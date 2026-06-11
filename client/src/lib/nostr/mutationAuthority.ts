import type { NostrEvent } from "../../types/nostr";
import type { Space } from "../../types/space";

/**
 * Authority decisions for inbound events that mutate state belonging to someone
 * else (NIP-09 kind:5 deletes, NIP-29 kind:9005 mod-deletes, group metadata, …).
 *
 * The chat/feed read set for native + decentralized spaces includes non-enforcing
 * mirrors and imported general-purpose relays, so the client cannot trust that a
 * relay only delivered authorized events — every such mutation must be re-checked
 * here against the space's pinned authority set. Pure functions over already-loaded
 * Redux data, so they are trivially unit-testable.
 */

/** Admins ∪ creator ∪ pinned relay key — the only pubkeys allowed to mutate
 *  space-scoped state. Single definition for the two former private copies in
 *  features/spaces/channelLayout.ts and features/spaces/relaySet.ts. */
export function spaceAuthoritySet(
  space: Pick<Space, "adminPubkeys" | "creatorPubkey" | "relayPubkey">,
): Set<string> {
  const set = new Set<string>(space.adminPubkeys);
  if (space.creatorPubkey) set.add(space.creatorPubkey);
  if (space.relayPubkey) set.add(space.relayPubkey);
  return set;
}

export type ModAuthorityVerdict = "apply" | "drop-unauthorized" | "defer-unknown-space";

/**
 * Authority check for h-tag-scoped moderation events (kind:9005 today).
 *  - space unknown (not yet loaded) → defer (caller drops + unmarks for retry)
 *  - event.pubkey ∈ authority set    → apply
 *  - otherwise                       → drop (forged / mirror-injected)
 */
export function verifySpaceModAuthority(event: NostrEvent, space: Space | undefined): ModAuthorityVerdict {
  if (!space) return "defer-unknown-space";
  return spaceAuthoritySet(space).has(event.pubkey) ? "apply" : "drop-unauthorized";
}

/** NIP-09 ownership: a deletion only applies to events authored by the deleter. */
export function mayDelete(deleterPubkey: string, target: Pick<NostrEvent, "pubkey">): boolean {
  return target.pubkey === deleterPubkey;
}
