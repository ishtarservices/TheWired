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
  MUSIC_TRACK: 31683,
  MUSIC_ALBUM: 33123,
  MUSIC_PLAYLIST: 30119,
  FOLLOW_SETS: 30000,
  BOOKMARK_SETS: 30003,
} as const;
