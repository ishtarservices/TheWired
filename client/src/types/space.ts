/**
 * How a space is governed and where its source of truth lives.
 * - `platform`            — backend-authoritative (default; today's spaces).
 * - `decentralized-alite` — backend still owns metadata/channels/roles, but the
 *                           creator picks an arbitrary `hostRelay` (BYO relay).
 * - `nip29-native`        — the space IS a standard NIP-29 group; metadata/members
 *                           come from relay events (39000/39001/39002), no backend.
 *
 * Absent on legacy/cached spaces → treat as `platform` (see `getSpaceType`).
 */
export type SpaceType = "platform" | "decentralized-alite" | "nip29-native";

/**
 * Canonical NIP-29 identity for decentralized spaces: the `<host>'<groupId>`
 * group address. For platform/A-lite this is derived from `hostRelay` + `id`
 * and is optional; for nip29-native it is the local identity key.
 */
export interface GroupRef {
  /** Bare relay host, e.g. "groups.0xchat.com" (no ws/wss scheme). */
  host: string;
  /** NIP-29 group id (the 39000 d-tag); equals `space.id` for native spaces. */
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
  /**
   * For nip29-native spaces: the host relay's master pubkey (NIP-11 `pubkey`),
   * which signs the group's 39000/39001/39002. The client MUST pin this as the
   * expected author of group state — otherwise any pubkey can forge a group's
   * admin/member lists. Captured via NIP-11 probe at create/import time.
   */
  relayPubkey?: string;
  /**
   * Mirror relays for this space (Decentralized Spaces M9). `hostRelay` is the
   * signing authority; these are additional relays that hold a replica of the
   * group's content. The client reads from whichever answers (dedup by id) and
   * publishes to all of them. Discovered from a kind:30078 `wired:relays:<id>`
   * overlay or added manually. Absent ⇒ single-relay space.
   */
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
export type SpaceChannelType = "chat" | "notes" | "media" | "articles" | "music" | "voice" | "video";

/** Feed mode for channels — "all" shows all members' content, "curated" shows only explicitly shared content */
export type ChannelFeedMode = "all" | "curated";

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
  /** If true, channel is deleted when all participants leave */
  temporary?: boolean;
  /** Feed mode: "all" shows all members' content, "curated" shows only explicitly shared content */
  feedMode: ChannelFeedMode;
}

/** Role within a space */
export interface SpaceRole {
  id: string;
  spaceId: string;
  name: string;
  position: number;
  color?: string;
  isDefault: boolean;
  isAdmin: boolean;
  permissions: string[];
}

/** Member with roles */
export interface SpaceMember {
  pubkey: string;
  roles: SpaceRole[];
  joinedAt: number;
}

/** Channel-level permission override */
export interface ChannelPermissionOverride {
  roleId: string;
  channelId: string;
  allow: string[];
  deny: string[];
}

/** Ban record */
export interface Ban {
  id: string;
  spaceId: string;
  pubkey: string;
  reason?: string;
  bannedBy: string;
  expiresAt?: number;
  createdAt: string;
}

/** Mute record */
export interface Mute {
  id: string;
  spaceId: string;
  pubkey: string;
  channelId?: string;
  mutedBy: string;
  expiresAt: number;
  createdAt: string;
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

// ── Onboarding Types ──────────────────────────────────────────────

export interface OnboardingConfig {
  spaceId: string;
  enabled: boolean;
  welcomeMessage: string | null;
  welcomeImage: string | null;
  requireCompletion: boolean;
}

export interface OnboardingQuestion {
  id: string;
  spaceId: string;
  title: string;
  description: string | null;
  position: number;
  required: boolean;
  multiple: boolean;
  answers: OnboardingAnswer[];
}

export interface OnboardingAnswer {
  id: string;
  questionId: string;
  label: string;
  emoji: string | null;
  position: number;
  mappings: AnswerMapping[];
}

export interface AnswerMapping {
  id: string;
  answerId: string;
  roleId: string | null;
  channelId: string | null;
}

export interface OnboardingTodoItem {
  id: string;
  spaceId: string;
  title: string;
  description: string | null;
  linkChannelId: string | null;
  position: number;
}

export interface MemberOnboardingState {
  completed: boolean;
  answers: Array<{ questionId: string; answerIds: string[] }>;
  todoCompleted: string[];
}

export interface OnboardingPreview {
  welcomeMessage: string | null;
  welcomeImage: string | null;
  requireCompletion: boolean;
  questions: Array<{
    id: string;
    title: string;
    description: string | null;
    required: boolean;
    multiple: boolean;
    position: number;
    answers: Array<{
      id: string;
      label: string;
      emoji: string | null;
      position: number;
    }>;
  }>;
  todoItems: OnboardingTodoItem[];
}

export interface OnboardingFullConfig {
  config: OnboardingConfig;
  questions: OnboardingQuestion[];
  todoItems: OnboardingTodoItem[];
}
