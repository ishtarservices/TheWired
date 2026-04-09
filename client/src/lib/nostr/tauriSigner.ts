import { invoke } from "@tauri-apps/api/core";
import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { NostrSigner } from "./signer";
import { serializeEvent } from "./serialization";

interface SignedEventResult {
  id: string;
  sig: string;
}

export class TauriSigner implements NostrSigner {
  async getPublicKey(): Promise<string> {
    return invoke<string>("keystore_get_public_key");
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    const serialized = serializeEvent(unsigned);
    const result = await invoke<SignedEventResult>("keystore_sign_event", {
      serializedEvent: serialized,
    });

    return {
      ...unsigned,
      id: result.id,
      sig: result.sig,
    };
  }

  async getSecretKey(): Promise<string> {
    return invoke<string>("keystore_get_secret_key");
  }

  async nip44Encrypt(recipientPubkey: string, plaintext: string): Promise<string> {
    return invoke<string>("keystore_nip44_encrypt", { recipientPubkey, plaintext });
  }

  async nip44Decrypt(senderPubkey: string, ciphertext: string): Promise<string> {
    return invoke<string>("keystore_nip44_decrypt", { senderPubkey, ciphertext });
  }

  /** List all stored account pubkeys */
  static async listAccounts(): Promise<string[]> {
    return invoke<string[]>("keystore_list_accounts");
  }

  /** Switch the active keystore account */
  static async switchAccount(pubkey: string): Promise<void> {
    await invoke("keystore_switch_account", { pubkey });
  }

  /** Generate a brand-new keypair (always creates new, never reuses). Returns pubkey. */
  static async generateKey(): Promise<string> {
    return invoke<string>("keystore_generate_key");
  }

  /** Clear the active pubkey in the keystore (on logout) */
  static async clearActive(): Promise<void> {
    await invoke("keystore_clear_active");
  }

  /**
   * Import an nsec (bech32) or hex secret key into the Tauri keystore.
   * Returns the resulting hex pubkey.
   */
  static async importKey(nsecOrHex: string): Promise<string> {
    let secretHex: string;

    if (nsecOrHex.startsWith("nsec1")) {
      const { decode } = await import("nostr-tools/nip19");
      const decoded = decode(nsecOrHex);
      if (decoded.type !== "nsec") {
        throw new Error("Invalid nsec string");
      }
      // decoded.data is Uint8Array for nsec
      secretHex = Array.from(decoded.data as Uint8Array)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } else {
      // Validate hex format: 64 hex chars = 32 bytes
      if (!/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
        throw new Error("Invalid secret key: must be 64 hex characters or an nsec");
      }
      secretHex = nsecOrHex.toLowerCase();
    }

    return invoke<string>("keystore_import_key", { secretHex });
  }
}
