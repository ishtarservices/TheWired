import { db } from "../db/connection.js";
import { trendingSnapshots } from "../db/schema/feeds.js";
import { eq, desc, sql } from "drizzle-orm";
import { getRedis } from "../lib/redis.js";

export const feedService = {
  async getTrending(params: { period: string; kind?: number; limit: number }) {
    const query = db
      .select()
      .from(trendingSnapshots)
      .where(eq(trendingSnapshots.period, params.period))
      .orderBy(desc(trendingSnapshots.score))
      .limit(params.limit);
    return await query;
  },

  async getPersonalized(pubkey: string, params: { page: number; pageSize: number }) {
    const redis = getRedis();
    const cacheKey = `personalized:${pubkey}:feed`;

    // Check Redis cache
    const cached = await redis.zrevrange(cacheKey, 0, -1, "WITHSCORES");
    if (cached.length > 0) {
      const start = (params.page - 1) * params.pageSize;
      const items: { eventId: string; score: number }[] = [];
      for (let i = 0; i < cached.length; i += 2) {
        items.push({ eventId: cached[i], score: parseFloat(cached[i + 1]) });
      }
      return items.slice(start, start + params.pageSize);
    }

    // Get user's follow list (kind:3 event) -- tags are JSONB in relay schema
    const follows = new Set<string>();
    try {
      const tagsRows = (await db.execute(
        sql`SELECT tags FROM relay.events WHERE pubkey = ${pubkey} AND kind = 3 ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as { tags: string[][] }[];
      if (tagsRows.length > 0 && Array.isArray(tagsRows[0].tags)) {
        for (const tag of tagsRows[0].tags) {
          if (tag[0] === "p" && tag[1]) follows.add(tag[1]);
        }
      }
    } catch {
      // ignore parse errors
    }

    // Get user's mute list (kind:10000)
    const muted = new Set<string>();
    try {
      const muteRows = (await db.execute(
        sql`SELECT tags FROM relay.events WHERE pubkey = ${pubkey} AND kind = 10000 ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as { tags: string[][] }[];
      if (muteRows.length > 0 && Array.isArray(muteRows[0].tags)) {
        for (const tag of muteRows[0].tags) {
          if (tag[0] === "p" && tag[1]) muted.add(tag[1]);
        }
      }
    } catch {
      // ignore
    }

    // Get trending events from last 24h
    const trending = await db
      .select()
      .from(trendingSnapshots)
      .where(eq(trendingSnapshots.period, "24h"))
      .orderBy(desc(trendingSnapshots.score))
      .limit(200);

    // Score and filter
    const scored: { eventId: string; score: number }[] = [];
    for (const item of trending) {
      // Get event author from relay.events
      const eventRows = (await db.execute(
        sql`SELECT pubkey FROM relay.events WHERE id = ${item.eventId} LIMIT 1`,
      )) as unknown as { pubkey: string }[];
      if (eventRows.length === 0) continue;

      const author = eventRows[0].pubkey;

      // Filter muted
      if (muted.has(author)) continue;

      // Boost followed authors
      let boost = 1;
      if (follows.has(author)) boost = 6;

      scored.push({ eventId: item.eventId, score: item.score * boost });
    }

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    // Cache in Redis with 1hr TTL
    if (scored.length > 0) {
      const pipeline = redis.pipeline();
      pipeline.del(cacheKey);
      for (const item of scored) {
        pipeline.zadd(cacheKey, item.score, item.eventId);
      }
      pipeline.expire(cacheKey, 3600);
      await pipeline.exec();
    }

    // Paginate
    const start = (params.page - 1) * params.pageSize;
    return scored.slice(start, start + params.pageSize);
  },
};
