/** API response envelope */
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

export interface ApiError {
  error: string;
  code: string;
  statusCode: number;
}

/** Space directory DTOs */
export interface SpaceDirectoryEntry {
  id: string;
  hostRelay: string;
  name: string;
  picture?: string;
  about?: string;
  category?: string;
  language?: string;
  memberCount: number;
  activeMembers24h: number;
  messagesLast24h: number;
  featured: boolean;
  tags: string[];
  createdAt: number;
}

export interface SpaceSearchParams {
  query?: string;
  category?: string;
  language?: string;
  sort?: "members" | "activity" | "created" | "trending";
  page?: number;
  pageSize?: number;
}

/** Invite DTOs */
export interface CreateInviteRequest {
  spaceId: string;
  maxUses?: number;
  expiresInHours?: number;
  label?: string;
  autoAssignRole?: string;
}

export interface InviteInfo {
  code: string;
  spaceId: string;
  spaceName: string;
  createdBy: string;
  maxUses: number | null;
  useCount: number;
  expiresAt: number | null;
  label?: string;
}

/** Feed DTOs */
export interface TrendingFeedParams {
  period?: "1h" | "6h" | "24h" | "7d";
  kind?: number;
  limit?: number;
}

export interface PersonalizedFeedParams {
  page?: number;
  pageSize?: number;
}

/** Push notification DTOs */
export interface PushSubscribeRequest {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  spaceIds?: string[];
}

/** Analytics DTOs */
export interface SpaceAnalytics {
  spaceId: string;
  period: string;
  totalMessages: number;
  uniqueAuthors: number;
  peakHour: number;
  topChannels: { channelId: string; messageCount: number }[];
  memberGrowth: { date: string; joined: number; left: number }[];
}

/** Content moderation DTOs */
export interface PinMessageRequest {
  eventId: string;
  channelId: string;
}

export interface ScheduleMessageRequest {
  content: string;
  channelId: string;
  scheduledAt: number;
  kind?: number;
}

/** Trending music params */
export interface TrendingMusicParams {
  period?: "1h" | "6h" | "24h" | "7d";
  kind?: 31683 | 33123;
  limit?: number;
}

/** Profile cache DTOs */
export interface BatchProfileRequest {
  pubkeys: string[];
}

export interface CachedProfile {
  pubkey: string;
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  fetchedAt: number;
}
