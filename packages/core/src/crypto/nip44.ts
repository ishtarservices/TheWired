// NIP-44 v2 surface for the shared DM crypto stack.
//
// Two layers:
//  1. `Nip44Codec` — encryption with the USER's key. Key custody differs per
//     platform (Tauri keystore IPC, NIP-07 extension, NIP-46 bunker, mobile
//     LocalNsecSigner), so the user-key half is always delegated to the
//     signer; the desktop's lib/nostr/nip44.ts dispatch shim and the mobile
//     LocalNsecSigner both satisfy this interface.
//  2. Ephemeral-key helpers — gift wraps (NIP-59) encrypt the seal with a
//     throwaway keypair that exists only in memory, so that half is pure
//     nostr-tools crypto and lives here.

import { getConversationKey, encrypt, decrypt } from "nostr-tools/nip44";

/** The NIP-44 half of a signer — what unwrapping/sealing rumors needs. */
export interface Nip44Codec {
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

/** NIP-44-encrypt `plaintext` from a raw (ephemeral) secret key to `peerPubkey`. */
export function nip44EncryptWithKey(
  secretKey: Uint8Array,
  peerPubkey: string,
  plaintext: string,
): string {
  return encrypt(plaintext, getConversationKey(secretKey, peerPubkey));
}

/** NIP-44-decrypt `ciphertext` sent to a raw secret key from `peerPubkey`. */
export function nip44DecryptWithKey(
  secretKey: Uint8Array,
  peerPubkey: string,
  ciphertext: string,
): string {
  return decrypt(ciphertext, getConversationKey(secretKey, peerPubkey));
}
