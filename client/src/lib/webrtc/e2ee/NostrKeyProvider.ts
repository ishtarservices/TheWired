import { BaseKeyProvider, createKeyMaterialFromBuffer, type KeyProviderOptions } from "livekit-client";

/**
 * LiveKit key-provider options for per-sender keys (docs/E2EE_CALLS.md):
 *
 * - `sharedKey: false` — every participant encrypts with their OWN key; the
 *   worker looks decryption keys up by participant identity (= pubkey).
 * - `keyringSize: 256` — the full one-byte index space, so frames still in
 *   flight under an older index decrypt after a rotation.
 * - `ratchetWindowSize: 0` / `failureTolerance: -1` — we never ratchet
 *   locally; fresh keys are distributed explicitly (derived for 1:1 calls,
 *   kind-20016 envelopes for channels). A worker that silently ratcheted on
 *   a decrypt failure would drift from the sender, and one that "gave up"
 *   after N failures would never recover once the late key arrives.
 */
export const NOSTR_KEY_PROVIDER_OPTIONS: Partial<KeyProviderOptions> = {
  sharedKey: false,
  keyringSize: 256,
  ratchetWindowSize: 0,
  failureTolerance: -1,
};

/**
 * Key provider whose identities are Nostr pubkeys (the backend mints the
 * LiveKit identity = pubkey, so the seal signature on a key envelope IS the
 * binding between a key and the participant it decrypts).
 */
export class NostrKeyProvider extends BaseKeyProvider {
  private readonly latest = new Map<string, number>();

  constructor() {
    super(NOSTR_KEY_PROVIDER_OPTIONS);
  }

  /**
   * Install `keyBytes` (32-byte LiveKit key material) as `identity`'s key at
   * `keyIndex`. For our own identity this also switches the encoder to that
   * index (LiveKit's `onSetEncryptionKey` always updates the current index).
   */
  async setSenderKey(identity: string, keyBytes: Uint8Array, keyIndex: number): Promise<void> {
    if (keyBytes.byteLength !== 32) throw new Error("sender key must be 32 bytes");
    if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 255) {
      throw new Error("key index must be 0–255");
    }
    // Copy into a fresh ArrayBuffer: WebCrypto wants an exact buffer, and the
    // caller's view may be a slice of a larger allocation.
    const buffer = new ArrayBuffer(32);
    new Uint8Array(buffer).set(keyBytes);
    const material = await createKeyMaterialFromBuffer(buffer);
    this.onSetEncryptionKey(material, identity, keyIndex);
    this.latest.set(identity, keyIndex);
  }

  /** Newest key index installed for `identity`, or -1. */
  latestIndex(identity: string): number {
    return this.latest.get(identity) ?? -1;
  }
}
