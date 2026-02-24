import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { NostrSigner } from "./signer";

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: UnsignedEvent): Promise<NostrEvent>;
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

export class NIP07Signer implements NostrSigner {
  private get ext() {
    if (!window.nostr) {
      throw new Error("NIP-07 extension not found");
    }
    return window.nostr;
  }

  async getPublicKey(): Promise<string> {
    return this.ext.getPublicKey();
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    return this.ext.signEvent(unsigned);
  }
}
