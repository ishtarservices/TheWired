import { EVENT_KINDS } from "@/types/nostr";
import type { UnsignedEvent } from "@/types/nostr";

// ── Types ──────────────────────────────────────────────────────────────

export type ProfileTab = "notes" | "reposts" | "replies" | "media" | "reads" | "music" | "showcase";

export interface ProfileSettings {
  hideFollowerCount: boolean;
  hideFollowingCount: boolean;
  hideFollowerList: boolean;
  hideFollowingList: boolean;
  visibleTabs: ProfileTab[];
}

export const ALL_TABS: ProfileTab[] = ["notes", "reposts", "replies", "media", "reads", "music", "showcase"];

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  hideFollowerCount: false,
  hideFollowingCount: false,
  hideFollowerList: false,
  hideFollowingList: false,
  visibleTabs: ["notes", "reposts", "replies", "media", "reads"] as ProfileTab[],
};

export const D_TAG = "thewired:profile_settings";

// ── In-memory cache ────────────────────────────────────────────────────

interface CacheEntry {
  settings: ProfileSettings;
  fetchedAt: number;
  /** created_at of the source event (0 = defaults / no event found) */
  eventCreatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedSettings(pubkey: string): ProfileSettings | null {
  const entry = cache.get(pubkey);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    cache.delete(pubkey);
    return null;
  }
  return entry.settings;
}

export function getCachedEventTimestamp(pubkey: string): number {
  return cache.get(pubkey)?.eventCreatedAt ?? 0;
}

export function cacheSettings(
  pubkey: string,
  settings: ProfileSettings,
  eventCreatedAt = 0,
): void {
  cache.set(pubkey, { settings, fetchedAt: Date.now(), eventCreatedAt });
}

/** Invalidate a single pubkey's cache (e.g. after publishing new settings) */
export function invalidateCache(pubkey: string): void {
  cache.delete(pubkey);
}

// ── Parse / Build ──────────────────────────────────────────────────────

export function parseProfileSettings(content: string): ProfileSettings {
  try {
    const parsed = JSON.parse(content);
    return {
      hideFollowerCount: !!parsed.hideFollowerCount,
      hideFollowingCount: !!parsed.hideFollowingCount,
      hideFollowerList: !!parsed.hideFollowerList,
      hideFollowingList: !!parsed.hideFollowingList,
      visibleTabs: Array.isArray(parsed.visibleTabs)
        ? parsed.visibleTabs.filter((t: unknown) =>
            ALL_TABS.includes(t as ProfileTab),
          )
        : [...ALL_TABS],
    };
  } catch {
    return { ...DEFAULT_PROFILE_SETTINGS };
  }
}

export function buildProfileSettingsEvent(
  pubkey: string,
  settings: ProfileSettings,
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.APP_SPECIFIC_DATA,
    tags: [["d", D_TAG]],
    content: JSON.stringify(settings),
  };
}
