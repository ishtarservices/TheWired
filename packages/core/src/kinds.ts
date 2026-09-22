// Event kinds the core modules need. Deliberately minimal — the full app
// kind table stays in each app's types (client/src/types/nostr.ts EVENT_KINDS);
// this is only what the shared crypto/protocol layer references. The DM
// kinds mirror DM_KINDS in @ishtarservices/shared-types (docs/DM_WIRE_CONTRACT.md).

import { DM_KINDS, DM_RUMOR_KINDS as SHARED_DM_RUMOR_KINDS } from "@ishtarservices/shared-types";

/** NIP-59 seal — signed by the real sender, wraps the encrypted rumor. */
export const KIND_SEAL = DM_KINDS.SEAL;
/** NIP-17 chat message rumor (unsigned, inside the seal). */
export const KIND_DM_MESSAGE = DM_KINDS.MESSAGE;
/** NIP-17 encrypted file message rumor. */
export const KIND_DM_FILE = DM_KINDS.FILE;
/** NIP-25 reaction (as a rumor inside a wrap for DMs). */
export const KIND_REACTION = DM_KINDS.REACTION;
/** NIP-59 gift wrap — signed by an ephemeral key, p-tags the recipient. */
export const KIND_GIFT_WRAP = DM_KINDS.GIFT_WRAP;
/** NIP-17 DM inbox relay list. */
export const KIND_DM_RELAYS = DM_KINDS.DM_RELAYS;
/** Typing indicator rumor (ours, short-lived wrap). */
export const KIND_DM_TYPING = DM_KINDS.TYPING;
/** Delivered / read receipt rumor (ours). */
export const KIND_DM_RECEIPT = DM_KINDS.RECEIPT;
/** NIP-78 app data (read-state record). */
export const KIND_APP_DATA = DM_KINDS.APP_DATA;

/** Rumor kinds `unwrapGiftWrap` accepts by default. */
export const DM_RUMOR_KINDS: readonly number[] = SHARED_DM_RUMOR_KINDS;
