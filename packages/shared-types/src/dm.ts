// DM wire contract — shared TYPES and constants for the NIP-17 direct-message
// stack (docs/DM_WIRE_CONTRACT.md). Consumed by @ishtarservices/core, the
// desktop client, the mobile app and the backend push planner. Keep this file
// free of runtime logic; the helpers live in @ishtarservices/core.

/** Bumped only for breaking wire changes. */
export const DM_WIRE_VERSION = 1 as const;

/** Event / rumor kinds the DM stack uses. */
export const DM_KINDS = {
  /** NIP-59 seal (signed by the real sender). */
  SEAL: 13,
  /** NIP-17 text message rumor. */
  MESSAGE: 14,
  /** NIP-17 encrypted file message rumor. */
  FILE: 15,
  /** NIP-25 reaction rumor inside a wrap. */
  REACTION: 7,
  /** NIP-59 gift wrap (ephemeral key, single `p`). */
  GIFT_WRAP: 1059,
  /** NIP-17 DM inbox relay list. */
  DM_RELAYS: 10050,
  /** Typing indicator rumor (ours; wrap expires in 30 s, no self-wrap). */
  TYPING: 20014,
  /** Delivered / read receipt rumor (ours; wrap expires in 7 d, no self-wrap). */
  RECEIPT: 20015,
  /** NIP-78 app data — the read-state record lives here. */
  APP_DATA: 30078,
} as const;

/** Rumor kinds a receiver accepts at unwrap; anything else is dropped. */
export const DM_RUMOR_KINDS: readonly number[] = [
  DM_KINDS.MESSAGE,
  DM_KINDS.FILE,
  DM_KINDS.REACTION,
  DM_KINDS.TYPING,
  DM_KINDS.RECEIPT,
];

/** Values of the `["type", …]` tag on kind-14 control rumors. `dm_reaction`
 *  is legacy-read only (the write form is a kind-7 rumor). */
export type DMControlType =
  | "dm_edit"
  | "dm_delete"
  | "dm_reaction"
  | "dm_reaction_remove"
  | "friend_request"
  | "friend_request_accept"
  | "friend_request_remove"
  | "call_invite"
  | "call_decline"
  | "call_missed";

export const DM_CONTROL_TYPES: readonly DMControlType[] = [
  "dm_edit",
  "dm_delete",
  "dm_reaction",
  "dm_reaction_remove",
  "friend_request",
  "friend_request_accept",
  "friend_request_remove",
  "call_invite",
  "call_decline",
  "call_missed",
];

/** Seconds of `expiration` (seal + wrap) per rumor class. `undefined` = none. */
export const DM_EXPIRATION_SECONDS = {
  typing: 30,
  receipt: 7 * 24 * 3600,
  call: 120,
} as const;

/** Advisory edit window shown by clients (receivers apply any edit from the
 *  original author regardless). */
export const DM_EDIT_WINDOW_SECONDS = 24 * 3600;

export type DMReceiptStatus = "delivered" | "read";

/** Kind-15 file message metadata (tags on the rumor; `url` is the content). */
export interface DMFileMeta {
  url: string;
  /** MIME type of the PLAINTEXT. */
  fileType: string;
  /** AES-256-GCM key, hex (32 bytes). */
  key: string;
  /** 12-byte nonce, hex. */
  nonce: string;
  /** sha256 hex of the encrypted blob (the Blossom hash). */
  x: string;
  /** sha256 hex of the plaintext. */
  ox: string;
  /** Bytes of the encrypted blob. */
  size?: number;
  /** `<w>x<h>` of the plaintext image/video. */
  dim?: string;
  blurhash?: string;
  /** URL of a thumbnail encrypted with the same key + nonce. */
  thumb?: string;
  /** Mirror URLs. */
  fallback?: string[];
  /** Voice notes / video: seconds (our extension). */
  duration?: number;
}

/** kind 30078, d = thewired:dm_read_state — v1 shape (still read). */
export interface DMReadStateRecordV1 {
  lastRead?: Record<string, number>;
}

/** A set/removed flag: positive = set at that unix time, negative = removed
 *  (tombstone) at that time. Larger |value| wins on merge. */
export type DMFlagStamp = number;

/** Disappearing-messages timer with the time it was set (for LWW merge). */
export interface DMExpireAfter {
  /** Seconds; 0 = off. */
  s: number;
  /** Unix seconds when set. */
  at: number;
}

/** kind 30078, d = thewired:dm_read_state — v2 shape (write form). All maps
 *  are keyed by conversationId (peer pubkey for 1:1, room id for rooms). */
export interface DMReadStateRecordV2 {
  v: 2;
  lastRead: Record<string, number>;
  pinned: Record<string, DMFlagStamp>;
  archived: Record<string, DMFlagStamp>;
  /** Positive = muted until that unix time (0 handled as "forever" via
   *  MUTED_FOREVER), negative = unmuted at |value|. */
  muted: Record<string, DMFlagStamp>;
  expireAfter: Record<string, DMExpireAfter>;
  updatedAt: number;
}

export type DMReadStateRecord = DMReadStateRecordV1 | DMReadStateRecordV2;

export const DM_READ_STATE_D_TAG = "thewired:dm_read_state";

/** The `data` object of a DM push (Expo → app / Notification Service Extension). */
export interface DMPushData {
  type: "dm";
  /** Deep link the tap opens. */
  url: string;
  /** The kind-1059 wrap id to fetch and decrypt on device. */
  eventId: string;
  /** Relay to fetch it from (wss://…). */
  relay: string;
}
