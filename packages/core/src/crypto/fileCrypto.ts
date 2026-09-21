// NIP-17 kind-15 file encryption — AES-256-GCM with a fresh key per file
// (docs/DM_WIRE_CONTRACT.md §3.4). Pure JS via @noble/ciphers so the same
// bytes come out on desktop (WebView), mobile (Hermes) and Node.
//
// The ciphertext (with the 16-byte GCM tag appended) is what gets uploaded to
// Blossom as an opaque blob; `x` is its sha256 (the Blossom hash), `ox` is the
// plaintext sha256. Receivers verify both before trusting the bytes.

import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";
import type { DMFileMeta } from "@ishtarservices/shared-types";

export const DM_FILE_KEY_BYTES = 32;
export const DM_FILE_NONCE_BYTES = 12;
export const DM_FILE_ALGORITHM = "aes-gcm";

export interface EncryptedDMFile {
  /** Ciphertext || 16-byte tag — upload this. */
  ciphertext: Uint8Array;
  /** hex, 32 bytes */
  key: string;
  /** hex, 12 bytes */
  nonce: string;
  /** sha256 hex of `ciphertext` */
  x: string;
  /** sha256 hex of the plaintext */
  ox: string;
  /** bytes of `ciphertext` */
  size: number;
}

/** Encrypt a file for a kind-15 message. */
export function encryptDMFile(
  plaintext: Uint8Array,
  opts?: { key?: Uint8Array; nonce?: Uint8Array },
): EncryptedDMFile {
  const key = opts?.key ?? randomBytes(DM_FILE_KEY_BYTES);
  const nonce = opts?.nonce ?? randomBytes(DM_FILE_NONCE_BYTES);
  if (key.length !== DM_FILE_KEY_BYTES) throw new Error("AES-256-GCM key must be 32 bytes");
  if (nonce.length !== DM_FILE_NONCE_BYTES) throw new Error("AES-GCM nonce must be 12 bytes");
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return {
    ciphertext,
    key: bytesToHex(key),
    nonce: bytesToHex(nonce),
    x: bytesToHex(sha256(ciphertext)),
    ox: bytesToHex(sha256(plaintext)),
    size: ciphertext.length,
  };
}

/**
 * Decrypt a kind-15 blob. Verifies `x` (if given) against the ciphertext
 * before decrypting and `ox` (if given) against the plaintext after — a
 * swapped blob or a tampered tag fails closed.
 */
export function decryptDMFile(
  ciphertext: Uint8Array,
  meta: Pick<DMFileMeta, "key" | "nonce"> & Partial<Pick<DMFileMeta, "x" | "ox">>,
): Uint8Array {
  if (meta.x && bytesToHex(sha256(ciphertext)) !== meta.x.toLowerCase()) {
    throw new Error("Encrypted file hash mismatch (x)");
  }
  const key = hexToBytes(meta.key);
  const nonce = hexToBytes(meta.nonce);
  if (key.length !== DM_FILE_KEY_BYTES) throw new Error("bad decryption-key length");
  if (nonce.length !== DM_FILE_NONCE_BYTES) throw new Error("bad decryption-nonce length");
  const plaintext = gcm(key, nonce).decrypt(ciphertext);
  if (meta.ox && bytesToHex(sha256(plaintext)) !== meta.ox.toLowerCase()) {
    throw new Error("Decrypted file hash mismatch (ox)");
  }
  return plaintext;
}
