import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import type { RTCSignalPayload, RTCSignalType } from "@/types/calling";
import { nip44Encrypt, nip44Decrypt } from "./nip44";
import { signAndPublish } from "./publish";
import { store } from "@/store";

/**
 * Generate a new room secret key for a 1:1 call.
 * The derived public key serves as the room ID.
 */
export function createCallRoom(): { secretKey: Uint8Array; roomId: string } {
  const secretKey = generateSecretKey();
  const roomId = getPublicKey(secretKey);
  return { secretKey, roomId };
}

/**
 * Convert a room secret key to hex string for transmission in gift wraps.
 */
export function secretKeyToHex(sk: Uint8Array): string {
  return Array.from(sk)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert a hex string back to Uint8Array for a room secret key.
 */
export function hexToSecretKey(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Create and publish a NIP-RTC signaling event (kind:25050).
 *
 * These are ephemeral events used for WebRTC negotiation.
 * Content is NIP-44 encrypted to the recipient.
 */
export async function publishRTCSignal(
  type: RTCSignalType,
  roomId: string,
  recipientPubkey: string | undefined,
  data?: RTCSignalPayload["data"],
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const tags: string[][] = [
    ["type", type],
    ["r", roomId],
  ];

  if (recipientPubkey) {
    tags.push(["p", recipientPubkey]);
  }

  // Set expiration for ephemeral events (5 minutes)
  if (type === "connect") {
    tags.push(["expiration", String(Math.round(Date.now() / 1000) + 300)]);
  }

  let content = "";
  if (data && recipientPubkey) {
    // Encrypt the data payload to recipient
    content = await nip44Encrypt(recipientPubkey, JSON.stringify(data));
  }

  const unsigned: UnsignedEvent = {
    pubkey: myPubkey,
    created_at: Math.round(Date.now() / 1000),
    kind: EVENT_KINDS.WEBRTC_SIGNAL,
    tags,
    content,
  };

  await signAndPublish(unsigned);
}

/**
 * Parse a received kind:25050 signaling event.
 */
export async function parseRTCSignal(
  event: NostrEvent,
): Promise<RTCSignalPayload | null> {
  const type = event.tags.find((t) => t[0] === "type")?.[1] as RTCSignalType | undefined;
  const roomId = event.tags.find((t) => t[0] === "r")?.[1];
  const recipientPubkey = event.tags.find((t) => t[0] === "p")?.[1];

  if (!type || !roomId) return null;

  let data: RTCSignalPayload["data"] | undefined;
  if (event.content && recipientPubkey) {
    try {
      const decrypted = await nip44Decrypt(event.pubkey, event.content);
      data = JSON.parse(decrypted);
    } catch {
      // Could not decrypt — not addressed to us
      return null;
    }
  }

  return {
    type,
    roomId,
    senderPubkey: event.pubkey,
    recipientPubkey,
    data,
  };
}
