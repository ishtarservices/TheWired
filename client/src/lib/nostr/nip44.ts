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

  if (signerType === "nip07") {
    if (!window.nostr?.nip44) {
      throw new Error(
        "NIP-44 encryption not supported by your browser extension. Please update your Nostr signer.",
      );
    }
    return signingQueue.enqueue(() => window.nostr!.nip44!.encrypt(recipientPubkey, plaintext));
  }

  if (signerType === "tauri_keystore") {
    const { TauriSigner } = await import("./tauriSigner");
    const signer = new TauriSigner();
    return signingQueue.enqueue(() => signer.nip44Encrypt(recipientPubkey, plaintext));
  }

  if (signerType === "nip46") {
    const { getSigner } = await import("./loginFlow");
    const signer = getSigner() as {
      nip44Encrypt?(p: string, t: string): Promise<string>;
    } | null;
    if (!signer?.nip44Encrypt) {
      throw new Error("Your remote signer doesn't support NIP-44 encryption.");
    }
    return signingQueue.enqueue(
      () => signer.nip44Encrypt!(recipientPubkey, plaintext),
      90_000,
    );
  }

  throw new Error("No signer available for NIP-44 encryption");
}

export async function nip44Decrypt(
  senderPubkey: string,
  ciphertext: string,
): Promise<string> {
  const signerType = store.getState().identity.signerType;

  if (signerType === "nip07") {
    if (!window.nostr?.nip44) {
      throw new Error(
        "NIP-44 decryption not supported by your browser extension. Please update your Nostr signer.",
      );
    }
    return signingQueue.enqueue(() => window.nostr!.nip44!.decrypt(senderPubkey, ciphertext));
  }

  if (signerType === "tauri_keystore") {
    const { TauriSigner } = await import("./tauriSigner");
    const signer = new TauriSigner();
    return signingQueue.enqueue(() => signer.nip44Decrypt(senderPubkey, ciphertext));
  }

  if (signerType === "nip46") {
    const { getSigner } = await import("./loginFlow");
    const signer = getSigner() as {
      nip44Decrypt?(p: string, c: string): Promise<string>;
    } | null;
    if (!signer?.nip44Decrypt) {
      throw new Error("Your remote signer doesn't support NIP-44 decryption.");
    }
    return signingQueue.enqueue(
      () => signer.nip44Decrypt!(senderPubkey, ciphertext),
      90_000,
    );
  }

  throw new Error("No signer available for NIP-44 decryption");
}
