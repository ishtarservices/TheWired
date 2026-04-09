import { db } from "../db/connection.js";
import { trendingSnapshots } from "../db/schema/feeds.js";
import { getRedis } from "../lib/redis.js";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "../lib/id.js";

interface EventRow {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
}

type Period = "1h" | "6h" | "24h" | "7d";

const PERIOD_HOURS: Record<Period, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 168,
};

function timeDecay(createdAt: number): number {
  const hoursSince = (Date.now() / 1000 - createdAt) / 3600;
  return 1 / Math.pow(1 + hoursSince / 24, 1.5);
}

/** Recompute trending feeds every 30 minutes (single 24h period for now) */
export function startTrendingComputer(): { stop: () => void } {
  async function compute() {
    console.log("[trending] Computing trending feeds...");
    const redis = getRedis();

    // Single period for now — re-enable multi-period when content volume justifies it
    try {
      await computePeriod("24h", redis);
    } catch (err) {
      console.error(`[trending] Error computing 24h:`, (err as Error).message);
    }
  }

  async function computePeriod(period: Period, redis: ReturnType<typeof getRedis>) {
    const hours = PERIOD_HOURS[period];
    const sinceTs = Math.floor(Date.now() / 1000) - hours * 3600;

    // 1. Fetch events (single query)
    const events = (await db.execute(
      sql`SELECT id, pubkey, created_at, kind, tags FROM relay.events
          WHERE created_at >= ${sinceTs}
            AND kind IN (1, 22, 30023, 34236, 31683, 33123)
            AND NOT (tags @> '[["visibility","unlisted"]]'::jsonb)
          ORDER BY created_at DESC
          LIMIT 2000`,
    )) as unknown as EventRow[];

    if (events.length === 0) {
      console.log(`[trending] ${period}: no events found`);
      return;
    }

    const eventIds = events.map((e) => e.id);
    const idList = sql.join(eventIds.map((id) => sql`${id}`), sql`, `);

    // 2. Batch reaction counts (1 query instead of N)
    const reactionRows = (await db.execute(
      sql`SELECT elem->>1 as event_id, COUNT(*)::int as count
          FROM relay.events, jsonb_array_elements(tags) as elem
          WHERE kind = 7
            AND elem->>0 = 'e'
            AND elem->>1 IN (${idList})
          GROUP BY elem->>1`,
    )) as unknown as { event_id: string; count: number }[];

    const reactionMap = new Map(reactionRows.map((r) => [r.event_id, r.count]));

    // 3. Batch comment counts (1 query instead of N)
    const commentRows = (await db.execute(
      sql`SELECT elem->>1 as event_id, COUNT(*)::int as count
          FROM relay.events, jsonb_array_elements(tags) as elem
          WHERE kind = 1111
            AND elem->>0 = 'e'
            AND elem->>1 IN (${idList})
          GROUP BY elem->>1`,
    )) as unknown as { event_id: string; count: number }[];

    const commentMap = new Map(commentRows.map((r) => [r.event_id, r.count]));

    // 4. Build Redis keys and MGET all counters in one call
    const zapTotalKeys: string[] = [];
    const zapCountKeys: string[] = [];
    const playCountKeys: string[] = [];

    for (const event of events) {
      zapTotalKeys.push(`zap_total:${event.id}`);
      zapCountKeys.push(`zap_count:${event.id}`);

      // Music kinds use addressable play_count key (stable across edits)
      const isMusicKind = event.kind === 31683 || event.kind === 33123;
      if (isMusicKind) {
        const dTag = event.tags?.find((t: string[]) => t[0] === "d")?.[1];
        if (dTag) {
          playCountKeys.push(`play_count:${event.kind}:${event.pubkey}:${dTag}`);
        } else {
          playCountKeys.push(`play_count:${event.id}`);
        }
      } else {
        playCountKeys.push(`play_count:${event.id}`);
      }
    }

    const allKeys = [...zapTotalKeys, ...zapCountKeys, ...playCountKeys];
    const allValues = allKeys.length > 0 ? await redis.mget(...allKeys) : [];

    // Parse MGET results back into per-event values
    const n = events.length;
    const zapTotals = allValues.slice(0, n).map((v) => parseInt(v ?? "0", 10));
    const zapCounts = allValues.slice(n, 2 * n).map((v) => parseInt(v ?? "0", 10));
    const playCounts = allValues.slice(2 * n, 3 * n).map((v) => parseInt(v ?? "0", 10));

    // 5. Score events in-memory
    const scored: { eventId: string; kind: number; score: number; tags: string[][] }[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const zapTotal = zapTotals[i];
      const zapCount = zapCounts[i];
      const playCount = playCounts[i];
      const reactionCount = reactionMap.get(event.id) ?? 0;
      const commentCount = commentMap.get(event.id) ?? 0;

      const logZapSats = zapTotal > 0 ? Math.log2(zapTotal) : 0;
      const rawScore =
        zapCount * 10 + reactionCount * 3 + playCount * 2 + commentCount * 5 + logZapSats * 2;
      const score = Math.round(rawScore * timeDecay(event.created_at) * 1000);

      if (score > 0) {
        scored.push({ eventId: event.id, kind: event.kind, score, tags: event.tags });
      }
    }

    // 6. Sort and take top 100
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 100);

    // 7. Clear old snapshots for this period and insert new ones
    await db.delete(trendingSnapshots).where(eq(trendingSnapshots.period, period));

    if (top.length > 0) {
      await db.insert(trendingSnapshots).values(
        top.map((item) => ({
          id: nanoid(16),
          period,
          kind: item.kind,
          eventId: item.eventId,
          score: item.score,
        })),
      );
    }

    // 8. Write to Redis sorted sets by kind
    const kindMap: Record<number, string> = {
      22: "trending:reels",
      34236: "trending:tracks",
      30023: "trending:longform",
      31683: "trending:music:tracks",
      33123: "trending:music:albums",
    };

    const pipeline = redis.pipeline();
    for (const [kind, key] of Object.entries(kindMap)) {
      pipeline.del(key);
      const items = top.filter((i) => i.kind === parseInt(kind, 10));
      for (const item of items) {
        pipeline.zadd(key, item.score, item.eventId);
      }
      pipeline.expire(key, PERIOD_HOURS[period] * 3600);
    }

    // Per-genre trending for music tracks (using carried tags, no re-fetch)
    const musicTrackItems = top.filter((i) => i.kind === 31683);
    for (const item of musicTrackItems) {
      const genreTag = item.tags?.find((t: string[]) => t[0] === "genre");
      if (genreTag?.[1]) {
        const genreKey = `trending:music:tracks:genre:${genreTag[1].toLowerCase()}`;
        pipeline.zadd(genreKey, item.score, item.eventId);
        pipeline.expire(genreKey, PERIOD_HOURS[period] * 3600);
      }
    }

    await pipeline.exec();

    console.log(`[trending] ${period}: scored ${events.length} events, top ${top.length} stored`);
  }

  // Run every 30 minutes (was 5 min — increase when content volume grows)
  const interval = setInterval(compute, 30 * 60 * 1000);
  compute();

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[trending] Stopped");
    },
  };
}
