import { store } from "@/store";
import { signingQueue } from "./signingQueue";

/**
 * NIP-44 encryption abstraction.
 * Delegates to the active signer's NIP-44 implementation.
 * - NIP-07: window.nostr.nip44.encrypt/decrypt
 * - Tauri: Future keystore_nip44_encrypt/decrypt IPC (not yet implemented)
 */

export async function nip44Encrypt(
  recipientPubkey: string,
  plaintext: string,
): Promise<string> {
  const signerType = store.getState().identity.signerType;
  console.debug("[nip44] encrypt called", {
    recipientPubkey: recipientPubkey.slice(0, 8) + "...",
    plaintextLength: plaintext.length,
    signerType,
  });

  if (signerType === "nip07") {
    if (!window.nostr?.nip44) {
      throw new Error(
        "NIP-44 encryption not supported by your browser extension. Please update your Nostr signer.",
      );
    }
    const result = await signingQueue.enqueue(() => window.nostr!.nip44!.encrypt(recipientPubkey, plaintext));
    console.debug("[nip44] encrypt OK, ciphertext length:", result.length);
    return result;
  }

  if (signerType === "tauri_keystore") {
    const { TauriSigner } = await import("./tauriSigner");
    const signer = new TauriSigner();
    const result = await signingQueue.enqueue(() => signer.nip44Encrypt(recipientPubkey, plaintext));
    console.debug("[nip44] encrypt OK (tauri), ciphertext length:", result.length);
    return result;
  }

  throw new Error("No signer available for NIP-44 encryption");
}

export async function nip44Decrypt(
  senderPubkey: string,
  ciphertext: string,
): Promise<string> {
  const signerType = store.getState().identity.signerType;
  console.debug("[nip44] decrypt called", {
    senderPubkey: senderPubkey.slice(0, 8) + "...",
    ciphertextLength: ciphertext.length,
    signerType,
  });

  if (signerType === "nip07") {
    if (!window.nostr?.nip44) {
      throw new Error(
        "NIP-44 decryption not supported by your browser extension. Please update your Nostr signer.",
      );
    }
    const result = await signingQueue.enqueue(() => window.nostr!.nip44!.decrypt(senderPubkey, ciphertext));
    console.debug("[nip44] decrypt OK, plaintext length:", result.length);
    return result;
  }

  if (signerType === "tauri_keystore") {
    const { TauriSigner } = await import("./tauriSigner");
    const signer = new TauriSigner();
    const result = await signingQueue.enqueue(() => signer.nip44Decrypt(senderPubkey, ciphertext));
    console.debug("[nip44] decrypt OK (tauri), plaintext length:", result.length);
    return result;
  }

  throw new Error("No signer available for NIP-44 decryption");
}
