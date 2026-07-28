import type { UnsignedEvent } from "@thewired/shared-types";
import { APP_DATA_KIND } from "./profileSettings";

// Profile "Library" showcase — a curated list of the user's own tracks/albums
// they choose to feature on their profile. Persisted as a NIP-78 (kind:30078)
// replaceable event, d-tag `thewired:profile_showcase`, so desktop and mobile
// read/write the same list. Items are addressable ids (kind:pubkey:d) mirrored
// as `a`-tags for relay-side queryability.

// ── Types ──────────────────────────────────────────────────────────────

export interface ShowcaseItem {
  type: "track" | "album";
  addressableId: string;
}

export interface ProfileShowcase {
  items: ShowcaseItem[];
}

export const SHOWCASE_D_TAG = "thewired:profile_showcase";
export const MAX_SHOWCASE_ITEMS = 50;

export const DEFAULT_SHOWCASE: ProfileShowcase = { items: [] };

// ── In-memory cache ────────────────────────────────────────────────────

interface CacheEntry {
  showcase: ProfileShowcase;
  fetchedAt: number;
  eventCreatedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function getCachedShowcase(pubkey: string): ProfileShowcase | null {
  const entry = cache.get(pubkey);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    cache.delete(pubkey);
    return null;
  }
  return entry.showcase;
}

export function getCachedShowcaseTimestamp(pubkey: string): number {
  return cache.get(pubkey)?.eventCreatedAt ?? 0;
}

export function cacheShowcase(
  pubkey: string,
  showcase: ProfileShowcase,
  eventCreatedAt = 0,
): void {
  cache.set(pubkey, { showcase, fetchedAt: Date.now(), eventCreatedAt });
}

export function invalidateShowcaseCache(pubkey: string): void {
  cache.delete(pubkey);
}

// ── Parse / Build ──────────────────────────────────────────────────────

export function parseShowcase(content: string): ProfileShowcase {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.items)) return { ...DEFAULT_SHOWCASE };
    const items: ShowcaseItem[] = parsed.items
      .filter(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          "addressableId" in item &&
          ((item as ShowcaseItem).type === "track" ||
            (item as ShowcaseItem).type === "album") &&
          typeof (item as ShowcaseItem).addressableId === "string",
      )
      .slice(0, MAX_SHOWCASE_ITEMS);
    return { items };
  } catch {
    return { ...DEFAULT_SHOWCASE };
  }
}

export function buildShowcaseEvent(
  pubkey: string,
  showcase: ProfileShowcase,
): UnsignedEvent {
  const aTags = showcase.items.map((item) => ["a", item.addressableId]);
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: APP_DATA_KIND,
    tags: [["d", SHOWCASE_D_TAG], ...aTags],
    content: JSON.stringify(showcase),
  };
}
