import { db } from "../db/connection.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { eq, inArray } from "drizzle-orm";

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
};
