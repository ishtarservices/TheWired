import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import {
  nip44DecryptWithKey,
  nip44EncryptWithKey,
  type SignerAdapter,
} from "@ishtarservices/core";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";

/**
 * Signs as a shared music project's own key (the "project key", soot
 * docs/collab-shared-key.md §4). The secret comes from `secretStore`, never the
 * identity keystore: `keystore_sign_event` only signs as the active identity and
 * `keystore_import_key` would make the project key the active identity.
 *
 * Signing is local and synchronous, so callers use this signer directly instead
 * of the global `signingQueue`; a project signature must never wait behind a
 * 90 s NIP-46 approval.
 */
export class ProjectKeySigner implements SignerAdapter {
  readonly pubkey: string;
  private readonly secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey;
    this.pubkey = getPublicKey(secretKey);
  }

  getPublicKey(): Promise<string> {
    return Promise.resolve(this.pubkey);
  }

  signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    if (unsigned.pubkey !== this.pubkey) {
      return Promise.reject(new Error("Event pubkey is not this project key"));
    }
    const { kind, created_at, tags, content } = unsigned;
    return Promise.resolve(finalizeEvent({ kind, created_at, tags, content }, this.secretKey) as NostrEvent);
  }

  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return Promise.resolve(nip44EncryptWithKey(this.secretKey, peerPubkey, plaintext));
  }

  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return Promise.resolve(nip44DecryptWithKey(this.secretKey, peerPubkey, ciphertext));
  }
}
