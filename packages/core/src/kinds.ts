// Event kinds the core modules need. Deliberately minimal — the full app
// kind table stays in each app's types (client/src/types/nostr.ts EVENT_KINDS);
// this is only what the shared crypto/protocol layer references.

/** NIP-59 seal — signed by the real sender, wraps the encrypted rumor. */
export const KIND_SEAL = 13;
/** NIP-17 chat message rumor (unsigned, inside the seal). */
export const KIND_DM_MESSAGE = 14;
/** NIP-59 gift wrap — signed by an ephemeral key, p-tags the recipient. */
export const KIND_GIFT_WRAP = 1059;
