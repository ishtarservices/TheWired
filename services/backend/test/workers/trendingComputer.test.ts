import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { getRedis } from "../../src/lib/redis.js";
import {
  selectTrending,
  computeTrendingPeriod,
  type ScoredItem,
} from "../../src/workers/trendingComputer.js";
import { LUNA } from "../helpers/testUsers.js";

/**
 * The cold-start behaviour: with no zaps, reactions or plays anywhere, every
 * candidate scores 0, and the old `score > 0` filter wrote empty sorted sets —
 * so `?sort=trending` returned `[]` permanently. Trending must instead degrade
 * to a recency ordering at the server, not just in the client.
 */

beforeAll(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS relay`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS relay.events (
      id TEXT PRIMARY KEY,
      pubkey TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      kind INTEGER NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]',
      content TEXT NOT NULL DEFAULT '',
      sig TEXT NOT NULL,
      d_tag TEXT,
      h_tag TEXT,
      visibility TEXT,
      p_tags TEXT[],
      e_tags TEXT[]
    )
  `);
  for (const col of ["h_tag TEXT", "visibility TEXT", "e_tags TEXT[]"]) {
    await db.execute(sql.raw(`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS ${col}`));
  }
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM relay.events`);
  await getRedis().flushall();
});

function item(id: string, score: number, kind = 31683): ScoredItem {
  return { eventId: id, kind, score, tags: [] };
}

describe("selectTrending", () => {
  it("uses engagement scores once enough items are actually engaged", () => {
    const engaged = Array.from({ length: 10 }, (_, i) => item(`e${i}`, (i + 1) * 100));
    const fallback = Array.from({ length: 50 }, (_, i) => item(`f${i}`, 1));

    const { items, usedFallback } = selectTrending(engaged, fallback);
    expect(usedFallback).toBe(false);
    expect(items).toHaveLength(10);
    expect(items[0].eventId).toBe("e9");
  });

  it("falls back to the recency pool when too few items scored above zero", () => {
    const engaged = [item("e0", 5000)];
    const fallback = Array.from({ length: 20 }, (_, i) => item(`f${i}`, i));

    const { items, usedFallback } = selectTrending(engaged, fallback);
    expect(usedFallback).toBe(true);
    expect(items).toHaveLength(20);
  });

  it("falls back when nothing is engaged at all — the cold-start case", () => {
    const fallback = Array.from({ length: 4 }, (_, i) => item(`f${i}`, i + 1));
    const { items, usedFallback } = selectTrending([], fallback);
    expect(usedFallback).toBe(true);
    expect(items.map((i) => i.eventId)).toEqual(["f3", "f2", "f1", "f0"]);
  });

  it("never returns an empty list when the fallback pool has content", () => {
    const { items } = selectTrending([], [item("only", 1)]);
    expect(items).toHaveLength(1);
  });

  it("returns nothing only when both pools are empty", () => {
    expect(selectTrending([], []).items).toEqual([]);
  });

  it("does not mutate the pools it was handed", () => {
    const fallback = [item("a", 1), item("b", 9)];
    selectTrending([], fallback);
    expect(fallback.map((i) => i.eventId)).toEqual(["a", "b"]);
  });
});

let seq = 0;
async function seedEvent(opts: {
  kind: number;
  ageSeconds?: number;
  genre?: string;
  hTag?: string | null;
}): Promise<string> {
  seq += 1;
  const id = `trend${seq}`.padEnd(64, "0").slice(0, 64);
  const tags: string[][] = [["d", `d${seq}`]];
  if (opts.genre) tags.push(["genre", opts.genre]);
  await db.execute(sql`
    INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, h_tag, visibility)
    VALUES (${id}, ${LUNA.pubkey}, ${Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 60)},
            ${opts.kind}, ${JSON.stringify(tags)}::jsonb, '', ${"0".repeat(128)},
            ${opts.hTag ?? null}, NULL)
  `);
  return id;
}

describe("computeTrendingPeriod", () => {
  it("writes a non-empty sorted set in a zero-engagement environment", async () => {
    const redis = getRedis();
    for (let i = 0; i < 5; i++) await seedEvent({ kind: 31683, ageSeconds: i * 600 });

    const result = await computeTrendingPeriod("24h", redis);
    expect(result.usedFallback).toBe(true);
    expect(result.stored).toBe(5);

    // The regression this guards: previously this set stayed empty forever.
    expect(await redis.zcard("trending:music:tracks")).toBe(5);
  });

  it("orders the fallback newest-first", async () => {
    const redis = getRedis();
    const oldest = await seedEvent({ kind: 31683, ageSeconds: 20 * 3600 });
    const newest = await seedEvent({ kind: 31683, ageSeconds: 60 });

    await computeTrendingPeriod("24h", redis);

    const ranked = await redis.zrevrange("trending:music:tracks", 0, -1);
    expect(ranked).toEqual([newest, oldest]);
  });

  it("gives every fallback item a strictly positive score", async () => {
    const redis = getRedis();
    // Nearly out of the window — decay is at its smallest here.
    await seedEvent({ kind: 31683, ageSeconds: 23 * 3600 + 3000 });

    await computeTrendingPeriod("24h", redis);

    const [, score] = await redis.zrevrange("trending:music:tracks", 0, -1, "WITHSCORES");
    expect(parseFloat(score)).toBeGreaterThan(0);
  });

  it("prefers real engagement once at least 10 items have some", async () => {
    const redis = getRedis();
    const engagedIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      // Seed them oldest-first so recency and engagement disagree.
      engagedIds.push(await seedEvent({ kind: 31683, ageSeconds: 3600 * (i + 2) }));
    }
    const freshButIgnored = await seedEvent({ kind: 31683, ageSeconds: 60 });

    for (const id of engagedIds) await redis.set(`zap_count:${id}`, "5");

    const result = await computeTrendingPeriod("24h", redis);
    expect(result.usedFallback).toBe(false);
    expect(result.stored).toBe(10);

    const ranked = await redis.zrevrange("trending:music:tracks", 0, -1);
    expect(ranked).not.toContain(freshButIgnored);
  });

  it("populates per-genre sets from the fallback too", async () => {
    const redis = getRedis();
    await seedEvent({ kind: 31683, genre: "Techno" });

    await computeTrendingPeriod("24h", redis);

    expect(await redis.zcard("trending:music:tracks:genre:techno")).toBe(1);
  });

  it("still excludes space-scoped events from the fallback", async () => {
    const redis = getRedis();
    await seedEvent({ kind: 31683, hTag: "some-space" });

    const result = await computeTrendingPeriod("24h", redis);
    expect(result.candidates).toBe(0);
    expect(await redis.zcard("trending:music:tracks")).toBe(0);
  });

  it("reports no fallback when there is no content at all", async () => {
    const result = await computeTrendingPeriod("24h", getRedis());
    expect(result).toEqual({ candidates: 0, stored: 0, usedFallback: false });
  });
});
