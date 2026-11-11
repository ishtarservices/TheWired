import { invoke } from "@tauri-apps/api/core";
import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { NostrSigner } from "./signer";
import { serializeEvent } from "./serialization";

interface SignedEventResult {
  id: string;
  sig: string;
}

/** Backup state of the active keystore account (see keystore.rs `BackupStatus`). */
export interface KeyBackupStatus {
  /** The user confirmed they hold a backup of this key (or imported it). */
  backedUp: boolean;
  /** A plaintext fallback copy of the key currently exists on disk. */
  fallbackPresent: boolean;
  /** Signed CI build — the only kind that ever drops the fallback file. */
  signedRelease: boolean;
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
    const secretHex = await parseSecretKey(nsecOrHex);
    return invoke<string>("keystore_import_key", { secretHex });
  }

  /**
   * The pubkey an nsec / hex secret belongs to, computed locally WITHOUT
   * touching the keystore. `importKey` makes the imported key the active
   * signer, so anything that must still be signed by the current account
   * (ending a call) has to know the target first. Throws on invalid input.
   */
  static async pubkeyForSecret(nsecOrHex: string): Promise<string> {
    const secretHex = await parseSecretKey(nsecOrHex);
    const [{ getPublicKey }, { hexToBytes }] = await Promise.all([
      import("nostr-tools/pure"),
      import("@noble/hashes/utils"),
    ]);
    return getPublicKey(hexToBytes(secretHex));
  }

  /** Store an arbitrary secret (NIP-46 bunker connection, NWC URI) in the OS keychain. */
  static async setSecret(key: string, value: string): Promise<void> {
    await invoke("keystore_set_secret", { key, value });
  }

  /** Read a secret stored via setSecret. Returns null if absent. */
  static async getSecret(key: string): Promise<string | null> {
    return invoke<string | null>("keystore_get_secret", { key });
  }

  /** Delete a secret stored via setSecret. */
  static async deleteSecret(key: string): Promise<void> {
    await invoke("keystore_delete_secret", { key });
  }

  /** Backup state of the active account. */
  static async backupStatus(): Promise<KeyBackupStatus> {
    return invoke<KeyBackupStatus>("keystore_backup_status");
  }

  /**
   * Record that the user confirmed a backup of the active key. On a signed
   * release build with a verified keychain copy this also removes the
   * plaintext fallback file. Returns the resulting status.
   */
  static async markBackedUp(): Promise<KeyBackupStatus> {
    return invoke<KeyBackupStatus>("keystore_mark_backed_up");
  }
}

/** Validate an nsec (bech32) or 64-hex secret and return it as lowercase hex. */
async function parseSecretKey(nsecOrHex: string): Promise<string> {
  if (nsecOrHex.startsWith("nsec1")) {
    const { decode } = await import("nostr-tools/nip19");
    const decoded = decode(nsecOrHex);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec string");
    }
    // decoded.data is Uint8Array for nsec
    return Array.from(decoded.data as Uint8Array)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Validate hex format: 64 hex chars = 32 bytes
  if (!/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    throw new Error("Invalid secret key: must be 64 hex characters or an nsec");
  }
  return nsecOrHex.toLowerCase();
}
