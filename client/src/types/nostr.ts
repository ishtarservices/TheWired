/** NIP-01 base event structure */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Event before signing -- no id or sig */
export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** NIP-01 filter for REQ */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [tagQuery: `#${string}`]: string[] | undefined;
}

/** Relay-to-client message types */
export type RelayMessage =
  | ["EVENT", string, NostrEvent]
  | ["OK", string, boolean, string]
  | ["EOSE", string]
  | ["CLOSED", string, string]
  | ["NOTICE", string]
  | ["AUTH", string];

/** Client-to-relay message types */
export type ClientMessage =
  | ["REQ", string, ...NostrFilter[]]
  | ["CLOSE", string]
  | ["EVENT", NostrEvent]
  | ["AUTH", NostrEvent];

/** Event kinds used in Phase 1 */
export const EVENT_KINDS = {
  METADATA: 0,
  SHORT_TEXT: 1,
  FOLLOW_LIST: 3,
  REPOST: 6,
  REACTION: 7,
  CHAT_MESSAGE: 9,
  PICTURE: 20,
  VIDEO_HORIZONTAL: 21,
  VIDEO_VERTICAL: 22,
  LONG_FORM: 30023,
  LONG_FORM_DRAFT: 30024,
  VIDEO_HORIZONTAL_ADDR: 34235,
  VIDEO_VERTICAL_ADDR: 34236,
  FILE_METADATA: 1063,
  COMMENT: 1111,
  LIVE_STREAM: 30311,
  LIVE_CHAT: 1311,
  ZAP_REQUEST: 9734,
  ZAP_RECEIPT: 9735,
  MUTE_LIST: 10000,
  PINNED_NOTES: 10001,
  BOOKMARKS: 10003,
  USER_GROUPS: 10009,
  RELAY_LIST: 10002,
  BLOSSOM_SERVER_LIST: 10063,
  GROUP_METADATA: 39000,
  GROUP_ADMINS: 39001,
  GROUP_MEMBERS: 39002,
  CLIENT_AUTH: 22242,
  APP_SPECIFIC_DATA: 30078,
  PUT_USER: 9000,
  REMOVE_USER: 9001,
  CREATE_GROUP: 9007,
  CREATE_INVITE: 9009,
  JOIN_REQUEST: 9021,
  LEAVE_REQUEST: 9022,
  DELETION: 5,
  MOD_DELETE_EVENT: 9005,
  MUSIC_TRACK: 31683,
  MUSIC_ALBUM: 33123,
  MUSIC_PLAYLIST: 30119,
  FOLLOW_SETS: 30000,
  BOOKMARK_SETS: 30003,
  SEAL: 13,
  DM_MESSAGE: 14,
  DM_FILE: 15,
  GIFT_WRAP: 1059,
  DM_RELAYS: 10050,
  MUSIC_TRACK_NOTES: 31686,
  MUSIC_PROPOSAL: 31685,
  /** NIP-53: Interactive Room definition (voice/video rooms) */
  INTERACTIVE_ROOM: 30312,
  /** NIP-53: Room Presence (who's in a room, hand raise, mute state) */
  ROOM_PRESENCE: 10312,
  /** NIP-RTC: WebRTC signaling (offer/answer/ICE) — ephemeral */
  WEBRTC_SIGNAL: 25050,
  /** NIP-53: Conference Event (scheduled meeting) */
  CONFERENCE: 30313,
  /** NIP-A0: Voice Message (async voice notes, up to 60s) */
  VOICE_MESSAGE: 1222,
  /** NIP-30: Custom emoji set (addressable, per pubkey+d-tag) */
  EMOJI_SET: 30030,
  /** NIP-51: User emoji list (replaceable) */
  USER_EMOJI_LIST: 10030,
} as const;
