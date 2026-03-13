import { nip19 } from "nostr-tools";

/**
 * Build a nostr:naddr1... reference string from an addressable ID.
 * @param addressableId e.g. "31683:pubkey:slug" or "33123:pubkey:slug"
 * @param relayHint Optional relay URL to include in the encoding
 */
export function buildNaddrReference(
  addressableId: string,
  relayHint?: string,
): string {
  const [kindStr, pubkey, ...identifierParts] = addressableId.split(":");
  const kind = parseInt(kindStr, 10);
  const identifier = identifierParts.join(":");

  const naddr = nip19.naddrEncode({
    kind,
    pubkey,
    identifier,
    relays: relayHint ? [relayHint] : [],
  });

  return `nostr:${naddr}`;
}
