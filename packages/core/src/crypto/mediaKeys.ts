// Media (frame-level E2EE) key derivation for LiveKit calls — shared by the
// desktop client and the mobile app so both derive identical sender keys.
//
// 1:1 DM calls: both peers already hold `roomSecretKey` (it travels inside
// the NIP-17 `call_invite` gift wrap; the server only ever sees its pubkey,
// the roomId). Each sender's frame key is derived from it with HKDF, bound to
// the room and to the sender's pubkey, so the two directions use distinct
// keys (SFrame / RFC 9605: one base key per sender) with zero extra
// signaling. Key index is 0 and never rotates — membership is fixed.
//
// The derived 32 bytes are the LiveKit key MATERIAL. Every SDK must derive
// the AES-GCM key from them the same way: PBKDF2-SHA256 with the ratchet
// salt ("LKFrameEncryptionKey", 100000 iterations, 128-bit) — what the native
// FrameCryptor and the Go SDK do with raw key bytes. On the JS side that
// means importing the bytes as PBKDF2 material (NOT the SDK's HKDF
// `createKeyMaterialFromBuffer`, which derives a different key and fails
// every cross-SDK frame with InvalidKey). See docs/E2EE_CALLS.md §2.
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/** HKDF salt; bump the suffix on any incompatible change. */
export const MEDIA_KEY_SALT = "thewired-e2ee-v1";
/** Length of a derived sender key (LiveKit HKDF material), bytes. */
export const MEDIA_KEY_BYTES = 32;

const HEX64 = /^[0-9a-f]{64}$/;

/** HKDF `info` for a call sender key — bound to the room AND the sender. */
export function callSenderKeyInfo(roomId: string, senderPubkey: string): string {
  return `lk:${roomId}:${senderPubkey}`;
}

/**
 * Derive the frame key `senderPubkey` uses to ENCRYPT in the 1:1 call room
 * `dm:<roomId>`. Both peers call it twice (own key + peer key).
 *
 * @param roomSecretKeyHex the 32-byte call secret from the invite, hex
 * @param roomId LiveKit room id (the secret's pubkey, hex)
 * @param senderPubkey the participant whose outbound frames this key protects
 */
export function deriveCallSenderKey(
  roomSecretKeyHex: string,
  roomId: string,
  senderPubkey: string,
): Uint8Array {
  if (!HEX64.test(roomSecretKeyHex)) throw new Error("roomSecretKey must be 32 bytes hex");
  if (!HEX64.test(roomId)) throw new Error("roomId must be 32 bytes hex");
  if (!HEX64.test(senderPubkey)) throw new Error("senderPubkey must be 32 bytes hex");
  return hkdf(
    sha256,
    hexToBytes(roomSecretKeyHex),
    utf8ToBytes(MEDIA_KEY_SALT),
    utf8ToBytes(callSenderKeyInfo(roomId, senderPubkey)),
    MEDIA_KEY_BYTES,
  );
}
