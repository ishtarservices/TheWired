import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceActivityDaily } from "../../src/db/schema/analytics.js";
import {
  refreshRollingStats,
  runDailyAggregation,
} from "../../src/workers/analyticsAggregator.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

/**
 * DB-backed tests for the analytics aggregator. relay.events is normally
 * created by the Rust relay; here we create a minimal version (same pattern as
 * test/routes/music.test.ts) and drive the exported aggregate functions
 * directly.
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
      visibility TEXT
    )
  `);
  // The table may pre-exist from relay migrations / other tests without these
  // columns (same pattern as music.test.ts patching visibility).
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS h_tag TEXT`);
  await db.execute(sql`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS d_tag TEXT`);
});

beforeEach(async () => {
  // relay.* is not covered by the global app.* truncation in test/setup.ts
  await db.execute(sql`DELETE FROM relay.events`);
});

let eventSeq = 0;

async function insertRelayEvent(opts: {
  kind: number;
  pubkey: string;
  hTag: string;
  createdAt: number;
}) {
  eventSeq += 1;
  const id = `analytics-test-event-${eventSeq}`.padEnd(64, "0");
  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, h_tag)
        VALUES (${id}, ${opts.pubkey}, ${opts.kind}, '[]'::jsonb, '', ${opts.createdAt}, ${"0".repeat(128)}, ${opts.hTag})`,
  );
}

async function seedSpace(id: string, stats?: { messages: number; active: number }) {
  await db.insert(spaces).values({
    id,
    hostRelay: "wss://relay.test.com",
    name: `Analytics ${id}`,
    createdAt: Math.floor(Date.now() / 1000),
    messagesLast24h: stats?.messages ?? 0,
    activeMembers24h: stats?.active ?? 0,
  });
}

async function getSpaceStats(id: string) {
  const [row] = await db
    .select({
      messagesLast24h: spaces.messagesLast24h,
      activeMembers24h: spaces.activeMembers24h,
    })
    .from(spaces)
    .where(eq(spaces.id, id));
  return row;
}

describe("refreshRollingStats", () => {
  it("recomputes rolling 24h stats and zeroes inactive spaces", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Both spaces start with stale nonzero stats
    await seedSpace("analytics-active", { messages: 99, active: 99 });
    await seedSpace("analytics-quiet", { messages: 50, active: 50 });

    // 3 messages from 2 distinct authors inside the window...
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-active", createdAt: now - 100 });
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-active", createdAt: now - 200 });
    await insertRelayEvent({ kind: 1, pubkey: MARCUS.pubkey, hTag: "analytics-active", createdAt: now - 300 });
    // ...plus a reaction (not a message kind) and a message outside the window
    await insertRelayEvent({ kind: 7, pubkey: LUNA.pubkey, hTag: "analytics-active", createdAt: now - 400 });
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-active", createdAt: now - 90_000 });

    await refreshRollingStats();

    expect(await getSpaceStats("analytics-active")).toEqual({
      messagesLast24h: 3,
      activeMembers24h: 2,
    });
    // No events in the window -> stale stats are zeroed, not left behind
    expect(await getSpaceStats("analytics-quiet")).toEqual({
      messagesLast24h: 0,
      activeMembers24h: 0,
    });
  });

  it("is idempotent across repeated runs", async () => {
    const now = Math.floor(Date.now() / 1000);
    await seedSpace("analytics-repeat");
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-repeat", createdAt: now - 60 });

    await refreshRollingStats();
    await refreshRollingStats();

    expect(await getSpaceStats("analytics-repeat")).toEqual({
      messagesLast24h: 1,
      activeMembers24h: 1,
    });
  });
});

describe("runDailyAggregation", () => {
  it("keys space_activity_daily by the UTC day matching the UTC window", async () => {
    await seedSpace("analytics-daily", { messages: 7, active: 7 });

    // Yesterday's UTC window, mirroring the worker's own boundary computation
    const todayUtcMidnight = new Date();
    todayUtcMidnight.setUTCHours(0, 0, 0, 0);
    const dayEnd = Math.floor(todayUtcMidnight.getTime() / 1000);
    const dayStart = dayEnd - 86_400;
    const expectedDate = new Date(dayStart * 1000).toISOString().split("T")[0];

    // Two messages inside yesterday (edges of the window), one the day before
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-daily", createdAt: dayStart + 10 });
    await insertRelayEvent({ kind: 1, pubkey: MARCUS.pubkey, hTag: "analytics-daily", createdAt: dayEnd - 10 });
    await insertRelayEvent({ kind: 9, pubkey: LUNA.pubkey, hTag: "analytics-daily", createdAt: dayStart - 10 });

    await runDailyAggregation();

    const [row] = await db
      .select()
      .from(spaceActivityDaily)
      .where(eq(spaceActivityDaily.spaceId, "analytics-daily"));
    expect(row).toBeTruthy();
    expect(row.date).toBe(expectedDate);
    expect(row.messageCount).toBe(2);
    expect(row.uniqueAuthors).toBe(2);

    // The daily pass no longer touches the rolling stats columns
    expect(await getSpaceStats("analytics-daily")).toEqual({
      messagesLast24h: 7,
      activeMembers24h: 7,
    });
  });
});
