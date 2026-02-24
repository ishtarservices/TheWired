import type { NostrEvent, UnsignedEvent } from "../../types/nostr";

/**
 * NIP-01 canonical JSON serialization for event ID computation.
 * Returns: [0, pubkey, created_at, kind, tags, content]
 */
export function serializeEvent(
  event: NostrEvent | UnsignedEvent,
): string {
  return JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
}
