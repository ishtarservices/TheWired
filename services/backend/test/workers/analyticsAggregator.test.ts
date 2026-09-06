import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceActivityDaily, memberEngagement } from "../../src/db/schema/analytics.js";
import {
  refreshRollingStats,
  runDailyAggregation,
  mergeMemberEngagement,
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
  tags?: string[][];
}) {
  eventSeq += 1;
  const id = `analytics-test-event-${eventSeq}`.padEnd(64, "0");
  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, h_tag)
        VALUES (${id}, ${opts.pubkey}, ${opts.kind}, ${JSON.stringify(opts.tags ?? [])}::jsonb, '',
                ${opts.createdAt}, ${"0".repeat(128)}, ${opts.hTag})`,
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

/**
 * `reactions_received` used to have two writers that disagreed: the ingest path
 * incremented it per kind:7, while this rollup rewrote the row's other columns
 * around it — so nothing owned the value and a replayed reaction inflated it
 * permanently. The daily rollup is now the authority for all three columns.
 */
describe("mergeMemberEngagement", () => {
  const activity = (spaceId: string, pubkey: string, messages: number, given: number) => ({
    h_tag: spaceId,
    pubkey,
    message_count: messages,
    reaction_count: given,
  });
  const received = (spaceId: string, pubkey: string, count: number) => ({
    h_tag: spaceId,
    pubkey,
    reactions_received: count,
  });

  it("merges both aggregates onto one row per space/pubkey", () => {
    const rows = mergeMemberEngagement(
      [activity("s1", "luna", 4, 2)],
      [received("s1", "luna", 7)],
    );

    expect(rows).toEqual([
      { spaceId: "s1", pubkey: "luna", messageCount: 4, reactionsGiven: 2, reactionsReceived: 7 },
    ]);
  });

  it("includes members who only RECEIVED reactions and authored nothing", () => {
    // The case an inner join would silently drop.
    const rows = mergeMemberEngagement([activity("s1", "luna", 1, 1)], [received("s1", "sage", 3)]);

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.pubkey === "sage")).toEqual({
      spaceId: "s1",
      pubkey: "sage",
      messageCount: 0,
      reactionsGiven: 0,
      reactionsReceived: 3,
    });
  });

  it("zeroes reactions_received for a member who received none", () => {
    const [row] = mergeMemberEngagement([activity("s1", "luna", 2, 0)], []);
    expect(row.reactionsReceived).toBe(0);
  });

  it("keeps the same pubkey in two spaces apart", () => {
    const rows = mergeMemberEngagement(
      [activity("s1", "luna", 1, 0), activity("s2", "luna", 5, 0)],
      [received("s2", "luna", 9)],
    );

    expect(rows.find((r) => r.spaceId === "s1")!.reactionsReceived).toBe(0);
    expect(rows.find((r) => r.spaceId === "s2")!.reactionsReceived).toBe(9);
  });

  it("drops rows with no space or no pubkey", () => {
    expect(
      mergeMemberEngagement(
        [activity("", "luna", 1, 1), activity("s1", "", 1, 1)],
        [received("", "luna", 1)],
      ),
    ).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(mergeMemberEngagement([], [])).toEqual([]);
  });
});

describe("runDailyAggregation — member_engagement", () => {
  function yesterday() {
    const todayUtcMidnight = new Date();
    todayUtcMidnight.setUTCHours(0, 0, 0, 0);
    const dayEnd = Math.floor(todayUtcMidnight.getTime() / 1000);
    return { dayStart: dayEnd - 86_400, dayEnd };
  }

  async function engagementFor(spaceId: string) {
    return db
      .select()
      .from(memberEngagement)
      .where(eq(memberEngagement.spaceId, spaceId));
  }

  it("recomputes reactions_received from relay.events", async () => {
    const { dayStart } = yesterday();
    await seedSpace("engagement-recompute");

    // MARCUS reacts twice to LUNA; the `p` tag names the recipient, matching
    // what ingestHandlers.indexReaction reads.
    for (const offset of [10, 20]) {
      await insertRelayEvent({
        kind: 7,
        pubkey: MARCUS.pubkey,
        hTag: "engagement-recompute",
        createdAt: dayStart + offset,
        tags: [["e", "some-note"], ["p", LUNA.pubkey]],
      });
    }

    await runDailyAggregation();

    const rows = await engagementFor("engagement-recompute");
    const luna = rows.find((r) => r.pubkey === LUNA.pubkey);
    const marcus = rows.find((r) => r.pubkey === MARCUS.pubkey);

    // LUNA authored nothing that day but still gets a row for what she received.
    expect(luna).toMatchObject({ messageCount: 0, reactionsGiven: 0, reactionsReceived: 2 });
    expect(marcus).toMatchObject({ reactionsGiven: 2, reactionsReceived: 0 });
  });

  it("corrects an inflated value left behind by the incremental ingest path", async () => {
    const { dayStart } = yesterday();
    const dateStr = new Date(dayStart * 1000).toISOString().split("T")[0];
    await seedSpace("engagement-correct");

    await insertRelayEvent({
      kind: 7,
      pubkey: MARCUS.pubkey,
      hTag: "engagement-correct",
      createdAt: dayStart + 10,
      tags: [["e", "some-note"], ["p", LUNA.pubkey]],
    });

    // Stand in for a replayed reaction the live path counted several times.
    await db.insert(memberEngagement).values({
      spaceId: "engagement-correct",
      pubkey: LUNA.pubkey,
      date: dateStr,
      messageCount: 0,
      reactionsGiven: 0,
      reactionsReceived: 99,
    });

    await runDailyAggregation();

    const [luna] = (await engagementFor("engagement-correct")).filter(
      (r) => r.pubkey === LUNA.pubkey,
    );
    expect(luna.reactionsReceived).toBe(1);
  });

  it("is idempotent across repeated runs", async () => {
    const { dayStart } = yesterday();
    await seedSpace("engagement-idempotent");

    await insertRelayEvent({
      kind: 9,
      pubkey: LUNA.pubkey,
      hTag: "engagement-idempotent",
      createdAt: dayStart + 10,
    });
    await insertRelayEvent({
      kind: 7,
      pubkey: MARCUS.pubkey,
      hTag: "engagement-idempotent",
      createdAt: dayStart + 20,
      tags: [["e", "some-note"], ["p", LUNA.pubkey]],
    });

    await runDailyAggregation();
    await runDailyAggregation();

    const rows = await engagementFor("engagement-idempotent");
    expect(rows.find((r) => r.pubkey === LUNA.pubkey)).toMatchObject({
      messageCount: 1,
      reactionsGiven: 0,
      reactionsReceived: 1,
    });
    expect(rows.find((r) => r.pubkey === MARCUS.pubkey)).toMatchObject({
      messageCount: 0,
      reactionsGiven: 1,
      reactionsReceived: 0,
    });
  });
});
