import { db } from "../db/connection.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { eq, inArray, sql } from "drizzle-orm";

/** Fields we persist from a kind:0 event's content. */
export interface ParsedProfileContent {
  name: string | null;
  displayName: string | null;
  picture: string | null;
  about: string | null;
  nip05: string | null;
  banner: string | null;
  lud16: string | null;
  lud06: string | null;
  website: string | null;
}

/** Parse a kind:0 `content` JSON string into the columns we cache. Returns null on bad JSON. */
export function parseProfileContent(content: string): ParsedProfileContent | null {
  let profile: Record<string, unknown>;
  try {
    profile = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    name: str(profile.name),
    displayName: str(profile.display_name),
    picture: str(profile.picture),
    about: str(profile.about),
    nip05: str(profile.nip05),
    banner: str(profile.banner),
    lud16: str(profile.lud16),
    lud06: str(profile.lud06),
    website: str(profile.website),
  };
}

export const profileCacheService = {
  async getProfile(pubkey: string) {
    const [profile] = await db
      .select()
      .from(cachedProfiles)
      .where(eq(cachedProfiles.pubkey, pubkey))
      .limit(1);
    return profile ?? null;
  },

  async getBatchProfiles(pubkeys: string[]) {
    if (pubkeys.length === 0) return [];
    return await db.select().from(cachedProfiles).where(inArray(cachedProfiles.pubkey, pubkeys));
  },

  /**
   * Version-guarded upsert of a kind:0 profile.
   *
   * kind:0 is a replaceable event whose `created_at` is its version. We only
   * overwrite an existing row when the incoming event is newer (or the stored
   * row predates versioning, created_at IS NULL). This prevents the classic
   * regression where a relay replays an OLD profile and clobbers a newer one.
   *
   * Returns the parsed profile fields (for Meilisearch indexing by the caller)
   * and whether the write was applied. Returns null on invalid JSON.
   */
  async upsert(input: {
    pubkey: string;
    createdAt: number;
    content: string;
  }): Promise<{ applied: boolean; profile: ParsedProfileContent } | null> {
    const profile = parseProfileContent(input.content);
    if (!profile) return null;

    const row = {
      pubkey: input.pubkey,
      ...profile,
      createdAt: input.createdAt,
      fetchedAt: Date.now(),
    };

    const result = await db
      .insert(cachedProfiles)
      .values(row)
      .onConflictDoUpdate({
        target: cachedProfiles.pubkey,
        set: {
          name: row.name,
          displayName: row.displayName,
          picture: row.picture,
          about: row.about,
          nip05: row.nip05,
          banner: row.banner,
          lud16: row.lud16,
          lud06: row.lud06,
          website: row.website,
          createdAt: row.createdAt,
          fetchedAt: row.fetchedAt,
        },
        // Only overwrite when the incoming event is strictly newer, or the
        // existing row predates versioning (created_at IS NULL).
        setWhere: sql`${cachedProfiles.createdAt} IS NULL OR ${cachedProfiles.createdAt} < ${input.createdAt}`,
      })
      .returning({ pubkey: cachedProfiles.pubkey });

    return { applied: result.length > 0, profile };
  },
};
