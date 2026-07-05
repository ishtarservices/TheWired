// ─── Local-key signer ────────────────────────────────────────────────
// SignerAdapter over a device-held secret key (nostr-tools + @noble).
//
// Custody trade-off, made deliberately for v1: the nsec lives in the OS
// keychain (expo-secure-store) and enters JS memory to sign — weaker than the
// desktop's "nsec never enters JS" Tauri model. The upgrade paths (NIP-46
// remote signing, a native keystore module — guide 00/04) are additional
// SignerAdapter implementations; nothing downstream changes.

import { finalizeEvent, getPublicKey, nip44 } from "nostr-tools";

import type { SignerAdapter } from "@/core/adapters";
import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

export class LocalNsecSigner implements SignerAdapter {
  readonly pubkey: string;
  private readonly secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
    this.pubkey = getPublicKey(secretKey);
  }

  async getPublicKey(): Promise<string> {
    return this.pubkey;
  }

  async signEvent(event: UnsignedEvent): Promise<NostrEvent> {
    // Same contract as the desktop signers: never sign on behalf of another
    // pubkey (guards against stale-account events after a switch).
    if (event.pubkey && event.pubkey !== this.pubkey) {
      throw new Error("Event pubkey does not match the active identity");
    }
    return finalizeEvent(
      {
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
        content: event.content,
      },
      this.secretKey,
    );
  }

  async nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, peerPubkey);
    return nip44.v2.encrypt(plaintext, key);
  }

  async nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    const key = nip44.v2.utils.getConversationKey(this.secretKey, peerPubkey);
    return nip44.v2.decrypt(ciphertext, key);
  }
}
