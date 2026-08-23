/**
 * Seed synthetic engagement so trending/discovery rails have something to rank
 * in a local dev stack.
 *
 * The trending computer scores zaps, reactions, plays and comments. A fresh dev
 * environment has none of those, so `/feeds/trending`, `/music/browse?sort=trending`
 * and `/music/tags/popular` come back empty — the server-side recency fallback
 * keeps them non-empty, but you still can't see *ranking* work. This fills in
 * plausible counters over content that already exists.
 *
 * DEV ONLY. Refuses to run against NODE_ENV=production.
 *
 * Writes Redis counters (zap/play), the music tag/genre zsets, and — so the
 * per-space zap rollup has anything to roll up — synthetic kind:9735 receipts in
 * relay.events. Every synthetic row's id starts with {@link SEED_PREFIX}, so
 * `--clean` removes exactly what this script added and nothing else. Receipt ids
 * are deterministic, so a re-run refreshes the existing rows' created_at instead
 * of inserting duplicates — the rollup only counts receipts younger than 24h, and
 * receipts written by yesterday's run must not silently age out of it.
 *
 *   pnpm --filter @thewired/backend exec tsx --env-file=.env src/scripts/seedDevEngagement.ts
 *   pnpm --filter @thewired/backend exec tsx --env-file=.env src/scripts/seedDevEngagement.ts --clean
 */
import { pathToFileURL } from "node:url";
import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";
import { getRedis } from "../lib/redis.js";
import { discoveryService } from "../services/discoveryService.js";
import { computeTrendingPeriod } from "../workers/trendingComputer.js";
import { computeProfileStats } from "../workers/profileStatsComputer.js";

/** Every synthetic relay.events row this script writes carries this id prefix. */
export const SEED_PREFIX = "deadseed";
/** Events whose Redis counters this script has already bumped. */
const SEED_APPLIED_KEY = "seed:engagement_applied";

/** Which of `ids` are already members of `key`. */
async function memberSet(
  redis: ReturnType<typeof getRedis>,
  key: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.sismember(key, id);
  const results = await pipeline.exec();
  return new Set(ids.filter((_, i) => results?.[i]?.[1]));
}

export interface EventRow {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  h_tag: string | null;
}

/** Deterministic pseudo-random in [0,1) from a string — same seed, same stack. */
function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Upsert one synthetic kind:9735 receipt per (deterministically) zapped space
 * event. The receipt id is derived from the target event id, so a re-run hits
 * the same rows — and must refresh created_at rather than DO NOTHING, because
 * rollupSpaceZaps only counts receipts younger than 24h: rows written by a
 * previous day's run would otherwise age out and a re-run would silently
 * leave the rollup empty while claiming it seeded receipts.
 */
export async function seedSpaceZapReceipts(
  spaceEvents: EventRow[],
  nowSec: number,
): Promise<{ inserted: number; refreshed: number }> {
  let inserted = 0;
  let refreshed = 0;

  for (const event of spaceEvents) {
    const roll = hashUnit(`zap:${event.id}`);
    if (roll >= 0.7) continue;
    const sats = 21 + Math.floor(roll * 2000);
    const request = JSON.stringify({ kind: 9734, tags: [["amount", String(sats * 1000)]] });
    const id = (SEED_PREFIX + event.id).slice(0, 64).padEnd(64, "0");

    // xmax = 0 iff the row was freshly inserted (a conflict-update stamps the
    // old version's xmax) — this is what lets us count writes, not attempts.
    const result = (await db.execute(sql`
      INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, e_tags)
      VALUES (
        ${id}, ${event.pubkey}, ${nowSec - Math.floor(roll * 6 * 3600)}, 9735,
        ${JSON.stringify([
          ["e", event.id],
          ["bolt11", "lnbc-dev-seed"],
          ["description", request],
        ])}::jsonb,
        '', ${"0".repeat(128)}, ARRAY[${event.id}]::text[]
      )
      ON CONFLICT (id) DO UPDATE SET created_at = EXCLUDED.created_at
      RETURNING (xmax = 0) AS inserted
    `)) as unknown as Array<{ inserted: boolean }>;

    if (result[0]?.inserted) inserted++;
    else if (result.length > 0) refreshed++;
  }

  return { inserted, refreshed };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("[seed] Refusing to run with NODE_ENV=production");
    process.exit(1);
  }

  const redis = getRedis();

  if (process.argv.includes("--clean")) {
    const removed = await db.execute(
      sql`DELETE FROM relay.events WHERE id LIKE ${SEED_PREFIX + "%"}`,
    );
    console.log(`[seed] Removed synthetic zap receipts (${SEED_PREFIX}*)`, removed);
    await redis.del(SEED_APPLIED_KEY);
    await discoveryService.rollupSpaceZaps();
    await discoveryService.computeDiscoveryScores();
    return;
  }

  const events = (await db.execute(sql`
    SELECT id, pubkey, kind, tags, h_tag
    FROM relay.events
    WHERE kind IN (1, 9, 22, 30023, 34236, 31683, 33123)
    ORDER BY created_at DESC
    LIMIT 500
  `)) as unknown as EventRow[];

  if (events.length === 0) {
    console.log("[seed] relay.events has no rankable content — publish something first.");
    return;
  }

  // Every counter this script touches is an INCR, so re-running it would
  // otherwise double the numbers. Two dedup sets keep the script idempotent:
  // SEED_APPLIED_KEY for the zap/play counters it invents, and the ingest path's
  // own music:counted_events for the genre/tag zsets it shares with ingest.
  const alreadySeeded = await memberSet(redis, SEED_APPLIED_KEY, events.map((e) => e.id));
  const musicIds = events.filter((e) => e.kind === 31683 || e.kind === 33123).map((e) => e.id);
  const alreadyCounted = await memberSet(redis, "music:counted_events", musicIds);

  const pipeline = redis.pipeline();
  let zapped = 0;
  let played = 0;
  let hashtagged = 0;

  for (const event of events) {
    if (alreadySeeded.has(event.id)) continue;
    pipeline.sadd(SEED_APPLIED_KEY, event.id);
    const roll = hashUnit(event.id);

    // ~60% of items get zapped, so ranking has real separation.
    if (roll < 0.6) {
      const zapCount = 1 + Math.floor(roll * 12);
      const sats = 21 * zapCount + Math.floor(roll * 5000);
      pipeline.incrby(`zap_count:${event.id}`, zapCount);
      pipeline.incrby(`zap_total:${event.id}`, sats);
      zapped++;
    }

    // Music gets plays, keyed by addressable id (stable across edits) exactly
    // like musicService.recordPlay writes them.
    if (event.kind === 31683 || event.kind === 33123) {
      const dTag = event.tags?.find((t) => t[0] === "d")?.[1];
      const key = dTag ? `play_count:${event.kind}:${event.pubkey}:${dTag}` : `play_count:${event.id}`;
      pipeline.incrby(key, 5 + Math.floor(roll * 400));
      played++;

      // Genre/tag zsets back /music/genres and /music/tags/popular.
      if (!alreadyCounted.has(event.id)) {
        pipeline.sadd("music:counted_events", event.id);
        const genre = event.tags?.find((t) => t[0] === "genre")?.[1];
        if (genre) pipeline.zincrby("music:genre_counts", 1, genre);
        const hashtags = event.tags?.filter((t) => t[0] === "t" && t[1]) ?? [];
        for (const t of hashtags) pipeline.zincrby("music:tag_counts", 1, t[1]);
        if (hashtags.length > 0) hashtagged++;
      }
    }
  }

  await pipeline.exec();
  console.log(
    `[seed] ${events.length} events (${alreadySeeded.size} already seeded) → ` +
      `${zapped} zapped, ${played} music items played`,
  );

  if (played > 0 && hashtagged === 0) {
    // /music/tags/popular ranks `t` tags, which uploads simply may not carry —
    // an empty response there is missing input, not a broken ranking.
    console.log(
      "[seed] No music event carries a `t` hashtag, so /music/tags/popular stays empty. " +
        "/music/genres is populated from `genre` tags instead.",
    );
  }

  // Space-scoped events need real kind:9735 receipts: rollupSpaceZaps derives
  // the 24h window from the receipts themselves, not from the all-time Redis
  // counters above (which can't answer "in the last 24 hours").
  const spaceEvents = events.filter((e) => e.h_tag);
  const nowSec = Math.floor(Date.now() / 1000);
  const { inserted, refreshed } = await seedSpaceZapReceipts(spaceEvents, nowSec);

  console.log(
    `[seed] ${inserted + refreshed} synthetic zap receipts over ${spaceEvents.length} space events ` +
      `(${inserted} new, ${refreshed} refreshed)`,
  );

  // Recompute the derived layers so the effect is visible immediately rather
  // than up to 30 minutes later.
  const trending = await computeTrendingPeriod("24h", redis);
  console.log(
    `[seed] trending: ${trending.stored} stored from ${trending.candidates} candidates` +
      (trending.usedFallback ? " (recency fallback)" : ""),
  );

  if (trending.candidates === 0) {
    // Distinguish "nothing scored" (which the recency fallback fixes) from
    // "nothing is in the window at all" (which it cannot): a dev database whose
    // newest post is weeks old has an empty 24h trending window by definition,
    // and no amount of seeded engagement changes that.
    const [newest] = (await db.execute(sql`
      SELECT MAX(created_at)::bigint AS created_at
      FROM relay.events
      WHERE kind IN (1, 22, 30023, 34236, 31683, 33123) AND h_tag IS NULL
    `)) as unknown as Array<{ created_at: string | null }>;

    if (!newest?.created_at) {
      console.log("[seed] No public rankable content exists — publish a note or a track first.");
    } else {
      const ageDays = Math.floor((nowSec - Number(newest.created_at)) / 86400);
      console.log(
        `[seed] The 24h trending window is empty: the newest public post is ${ageDays} day(s) ` +
          `old. Trending is correctly empty here — publish something recent to see it rank.`,
      );
    }
  }

  const rollup = await discoveryService.rollupSpaceZaps();
  await discoveryService.computeDiscoveryScores();
  console.log(`[seed] space zap rollup: ${rollup.receipts} receipts → ${rollup.spaces} spaces`);

  const stats = await computeProfileStats();
  console.log(`[seed] profile note_count: ${stats.profiles} profiles`);

  if (stats.profiles > 0) {
    // note_count backs /search/people ordering and is a 30-day window over
    // public kind:1 notes — same trap as the trending window above: seeded
    // engagement can't put anything in a window no content falls into.
    const noteWindowStart = nowSec - 30 * 24 * 3600;
    const [newestNote] = (await db.execute(sql`
      SELECT MAX(created_at)::bigint AS created_at
      FROM relay.events
      WHERE kind = 1 AND h_tag IS NULL AND visibility IS NULL
    `)) as unknown as Array<{ created_at: string | null }>;

    if (!newestNote?.created_at) {
      console.log(
        "[seed] No public kind:1 notes exist, so every profile reads note_count 0 — " +
          "publish a note to see /search/people ranking work.",
      );
    } else if (Number(newestNote.created_at) < noteWindowStart) {
      const ageDays = Math.floor((nowSec - Number(newestNote.created_at)) / 86400);
      console.log(
        `[seed] note_count's 30-day window is empty: the newest public note is ${ageDays} day(s) ` +
          `old, so every profile reads note_count 0 and /search/people ordering is flat. ` +
          `That is an empty window, not a broken ranking — publish something recent to see it rank.`,
      );
    }
  }
}

// Guard so tests can import seedSpaceZapReceipts without running the script.
const isMain =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed] Failed:", err);
      process.exit(1);
    });
}
