/**
 * How a space is governed and where its source of truth lives.
 * - `platform`            — backend-authoritative (default; today's spaces).
 * - `decentralized-alite` — backend owns metadata/channels/roles, creator picks `hostRelay`.
 * - `nip29-native`        — the space IS a NIP-29 group; metadata from relay events, no backend.
 *
 * Absent ⇒ treat as `platform`.
 */
export type SpaceType = "platform" | "decentralized-alite" | "nip29-native";

/** Canonical NIP-29 `<host>'<groupId>` identity for decentralized spaces. */
export interface GroupRef {
  /** Bare relay host (no ws/wss scheme), e.g. "groups.0xchat.com". */
  host: string;
  /** NIP-29 group id (39000 d-tag); equals `space.id` for native spaces. */
  groupId: string;
}

/** Where a space's channel list comes from. */
export type ChannelSource = "backend" | "layout-event" | "synthesized";

/** Which kind:30078 channel-layout convention a native space follows. */
export type LayoutConvention = "wired" | "obelisk" | null;

/** NIP-29 group metadata */
export interface Space {
  id: string;
  hostRelay: string;
  name: string;
  picture?: string;
  about?: string;
  isPrivate: boolean;
  adminPubkeys: string[];
  memberPubkeys: string[];
  /** Curated pubkeys whose content appears in feed-mode spaces */
  feedPubkeys: string[];
  mode: "read" | "read-write";
  creatorPubkey: string;
  createdAt: number;

  // ── Decentralized Spaces (optional; absent ⇒ legacy "platform") ──
  /** Governance/source-of-truth mode. Defaults to `platform` when absent. */
  spaceType?: SpaceType;
  /** NIP-29 `<host>'<groupId>` identity (decentralized modes). */
  groupRef?: GroupRef;
  /** Where channels come from (defaults to `backend` for platform/A-lite). */
  channelSource?: ChannelSource;
  /** Layout convention for native spaces (detected at import). */
  layoutConvention?: LayoutConvention;
  /** Host relay master pubkey (NIP-11) that signs a native group's 39000-2.
   *  Pinned as the expected author of group state to prevent forgery. */
  relayPubkey?: string;
  /** Mirror relays (M9): additional relays holding a replica of the group's
   *  content. `hostRelay` is the authority; client reads-from-any/publishes-to-all. */
  relayUrls?: string[];
}

/** Channel within a space */
export interface Channel {
  id: string;
  spaceId: string;
  type: ChannelType;
  label: string;
}

export type ChannelType =
  | "chat"
  | "reels"
  | "long-form"
  | "announcements"
  | "live";

/** Channel types available in client-defined spaces */
export type SpaceChannelType = "chat" | "notes" | "media" | "articles" | "music";

/** A backend-managed channel within a space */
export interface SpaceChannel {
  id: string;
  spaceId: string;
  type: SpaceChannelType;
  label: string;
  categoryId?: string;
  position: number;
  isDefault: boolean;
  adminOnly: boolean;
  slowModeSeconds: number;
}

/** Channel route configuration */
export interface ChannelRoute {
  kinds: number[];
  usesHTag: boolean;
  pageSize: number;
  sortOrder: "asc" | "desc";
  adminOnly?: boolean;
  paginated?: boolean;
}

/** Route config for client-defined space channels */
export interface SpaceChannelRoute {
  kinds: number[];
  filterMode: "htag" | "authors";
  pageSize: number;
  sortOrder: "asc" | "desc";
}
