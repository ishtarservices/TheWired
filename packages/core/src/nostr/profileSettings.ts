import type { UnsignedEvent } from "@thewired/shared-types";

/** NIP-78 addressable app-data kind (30078). Kept as a local literal so runtime
 *  code never *value*-imports @thewired/shared-types — the mobile app's jest
 *  can't resolve that package's ESM `.js` specifiers, and dmEngine hardcodes
 *  the same number for the same reason. */
export const APP_DATA_KIND = 30078;

// Profile display settings — the single public-shape control for a Wired
// profile: which sections (tabs) are visible to other people. Persisted as a
// NIP-78 (kind:30078) replaceable event so desktop and mobile share one source
// of truth; a change on either surfaces on the other.
//
// History: this model used to also carry four follower/following hide-flags.
// The platform dropped follower/following counts entirely (community direction),
// so the model collapsed to a single concern — visibleTabs. parseProfileSettings
// stays tolerant of the legacy `hide*` fields on old events (they're ignored).

// ── Types ──────────────────────────────────────────────────────────────

export type ProfileTab =
  | "notes"
  | "reposts"
  | "replies"
  | "media"
  | "reads"
  | "music"
  | "showcase";

export interface ProfileSettings {
  visibleTabs: ProfileTab[];
}

export const ALL_TABS: ProfileTab[] = [
  "notes",
  "reposts",
  "replies",
  "media",
  "reads",
  "music",
  "showcase",
];

/** Music + Library(showcase) are opt-in — hidden until the user enables them. */
export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  visibleTabs: ["notes", "reposts", "replies", "media", "reads"],
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
    // Legacy `hide*` fields are intentionally ignored — see file header.
    return {
      visibleTabs: Array.isArray(parsed.visibleTabs)
        ? parsed.visibleTabs.filter((t: unknown) =>
            ALL_TABS.includes(t as ProfileTab),
          )
        : [...DEFAULT_PROFILE_SETTINGS.visibleTabs],
    };
  } catch {
    return { visibleTabs: [...DEFAULT_PROFILE_SETTINGS.visibleTabs] };
  }
}

export function buildProfileSettingsEvent(
  pubkey: string,
  settings: ProfileSettings,
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: APP_DATA_KIND,
    tags: [["d", D_TAG]],
    content: JSON.stringify(settings),
  };
}
