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

/** Recompute trending feeds every 5 minutes */
export function startTrendingComputer() {
  async function compute() {
    console.log("[trending] Computing trending feeds...");
    const redis = getRedis();

    for (const period of ["1h", "6h", "24h", "7d"] as Period[]) {
      try {
        await computePeriod(period, redis);
      } catch (err) {
        console.error(`[trending] Error computing ${period}:`, (err as Error).message);
      }
    }
  }

  async function computePeriod(period: Period, redis: ReturnType<typeof getRedis>) {
    const hours = PERIOD_HOURS[period];
    const sinceTs = Math.floor(Date.now() / 1000) - hours * 3600;

    // Query events from relay schema for this period
    // Content kinds: reels (22), tracks (34236), longform (30023), short notes (1)
    const events = (await db.execute(
      sql`SELECT id, pubkey, created_at, kind FROM relay.events
          WHERE created_at >= ${sinceTs}
            AND kind IN (1, 22, 30023, 34236, 31683, 33123)
            AND NOT (tags @> '[["visibility","unlisted"]]'::jsonb)
          ORDER BY created_at DESC
          LIMIT 2000`,
    )) as unknown as EventRow[];

    const scored: { eventId: string; kind: number; score: number }[] = [];

    for (const event of events) {
      // Fetch counters from Redis
      const [zapTotal, zapCount, viewCount] = await Promise.all([
        redis.get(`zap_total:${event.id}`).then((v) => parseInt(v ?? "0", 10)),
        redis.get(`zap_count:${event.id}`).then((v) => parseInt(v ?? "0", 10)),
        redis.get(`view_count:${event.id}`).then((v) => parseInt(v ?? "0", 10)),
      ]);

      // Count reactions (kind:7 with e tag pointing to this event)
      const reactionRows = (await db.execute(
        sql`SELECT COUNT(*)::int as count FROM relay.events
            WHERE kind = 7 AND tags @> ${JSON.stringify([["e", event.id]])}::jsonb`,
      )) as unknown as { count: number }[];
      const reactionCount = reactionRows[0]?.count ?? 0;

      // Count comments (kind:1111 replies)
      const commentRows = (await db.execute(
        sql`SELECT COUNT(*)::int as count FROM relay.events
            WHERE kind = 1111 AND tags @> ${JSON.stringify([["e", event.id]])}::jsonb`,
      )) as unknown as { count: number }[];
      const commentCount = commentRows[0]?.count ?? 0;

      // Compute score per ARCHITECTURE.md formula
      const logZapSats = zapTotal > 0 ? Math.log2(zapTotal) : 0;
      const rawScore =
        zapCount * 10 + reactionCount * 3 + viewCount * 1 + commentCount * 5 + logZapSats * 2;
      const score = Math.round(rawScore * timeDecay(event.created_at) * 1000);

      if (score > 0) {
        scored.push({ eventId: event.id, kind: event.kind, score });
      }
    }

    // Sort and take top 100
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 100);

    // Clear old snapshots for this period
    await db.delete(trendingSnapshots).where(eq(trendingSnapshots.period, period));

    // Insert new snapshots
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

    // Write to Redis sorted sets by kind
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
    await pipeline.exec();

    console.log(`[trending] ${period}: scored ${events.length} events, top ${top.length} stored`);
  }

  // Run every 5 minutes
  setInterval(compute, 5 * 60 * 1000);
  compute();
}
