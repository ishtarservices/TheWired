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
