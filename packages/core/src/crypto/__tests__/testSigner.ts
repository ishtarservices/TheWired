// A local-key SignerAdapter for core test suites — the same shape mobile's
// LocalNsecSigner implements (nostr-tools finalizeEvent + nip44 v2).

import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { getConversationKey, encrypt, decrypt } from "nostr-tools/nip44";
import type { SignerAdapter } from "../../adapters";
import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

export interface TestIdentity {
  sk: Uint8Array;
  pubkey: string;
  signer: SignerAdapter;
}

export function makeTestIdentity(): TestIdentity {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer: SignerAdapter = {
    getPublicKey: async () => pubkey,
    signEvent: async (unsigned: UnsignedEvent) =>
      finalizeEvent(unsigned as Parameters<typeof finalizeEvent>[0], sk) as unknown as NostrEvent,
    nip44Encrypt: async (peer: string, plaintext: string) =>
      encrypt(plaintext, getConversationKey(sk, peer)),
    nip44Decrypt: async (peer: string, ciphertext: string) =>
      decrypt(ciphertext, getConversationKey(sk, peer)),
  };
  return { sk, pubkey, signer };
}
