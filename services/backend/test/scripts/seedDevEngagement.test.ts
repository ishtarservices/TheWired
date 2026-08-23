import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { discoveryService } from "../../src/services/discoveryService.js";
import {
  seedSpaceZapReceipts,
  SEED_PREFIX,
  type EventRow,
} from "../../src/scripts/seedDevEngagement.js";
import { LUNA } from "../helpers/testUsers.js";

/**
 * The seed script's synthetic zap receipts have deterministic ids, so a re-run
 * without --clean hits the same rows. These tests pin the contract that makes
 * that safe: a re-run must refresh created_at back into rollupSpaceZaps' 24h
 * window (not silently no-op against yesterday's rows), and the reported
 * counts must reflect rows actually written.
 *
 * relay.events is normally created by the Rust relay; we create a minimal
 * version here (same pattern as test/services/discoveryZaps.test.ts).
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
  for (const col of ["h_tag TEXT", "d_tag TEXT", "visibility TEXT", "e_tags TEXT[]", "p_tags TEXT[]"]) {
    await db.execute(sql.raw(`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS ${col}`));
  }
});

beforeEach(async () => {
  // relay.* is not covered by the global app.* truncation in test/setup.ts
  await db.execute(sql`DELETE FROM relay.events`);
});

/** Insert a space-scoped content event a synthetic receipt can target. */
async function seedSpaceContent(n: number, hTag = "space-seed"): Promise<EventRow[]> {
  const rows: EventRow[] = [];
  for (let i = 0; i < n; i++) {
    // The "x" terminator keeps zero-padding from making "…1" and "…10" collide.
    const id = `${hTag.replace(/-/g, "")}content${i}x`.padEnd(64, "0").slice(0, 64);
    await db.execute(sql`
      INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, h_tag, e_tags)
      VALUES (${id}, ${LUNA.pubkey}, ${Math.floor(Date.now() / 1000)}, 1, '[]'::jsonb, 'hi',
              ${"0".repeat(128)}, ${hTag}, '{}')
    `);
    rows.push({ id, pubkey: LUNA.pubkey, kind: 1, tags: [], h_tag: hTag });
  }
  return rows;
}

async function seedSpaceRow(id: string) {
  await db.insert(spaces).values({
    id,
    hostRelay: "wss://relay.test.com",
    name: `Space ${id}`,
    listed: true,
    memberCount: 5,
    createdAt: Math.floor(Date.now() / 1000) - 90 * 24 * 3600, // old: no recency bonus
  });
}

interface ReceiptRow {
  id: string;
  pubkey: string;
  created_at: string;
  kind: number;
  tags: string[][];
  e_tags: string[];
}

async function readReceipts(): Promise<ReceiptRow[]> {
  return (await db.execute(sql`
    SELECT id, pubkey, created_at, kind, tags, e_tags
    FROM relay.events
    WHERE id LIKE ${SEED_PREFIX + "%"}
    ORDER BY id
  `)) as unknown as ReceiptRow[];
}

async function countReceipts(): Promise<{ total: number; inWindow: number }> {
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const [row] = (await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE created_at >= ${since})::int AS in_window
    FROM relay.events
    WHERE id LIKE ${SEED_PREFIX + "%"}
  `)) as unknown as Array<{ total: number; in_window: number }>;
  return { total: Number(row.total), inWindow: Number(row.in_window) };
}

describe("seedSpaceZapReceipts", () => {
  it("re-run refreshes yesterday's receipts back into the 24h rollup window", async () => {
    const events = await seedSpaceContent(12);
    const nowSec = Math.floor(Date.now() / 1000);

    // First run happened "two days ago": every receipt lands outside the
    // rollup's 24h window, which is exactly the state a stale dev DB is in.
    const first = await seedSpaceZapReceipts(events, nowSec - 2 * 24 * 3600);
    expect(first.inserted).toBeGreaterThan(0);
    expect(first.refreshed).toBe(0);

    const stale = await discoveryService.rollupSpaceZaps();
    expect(stale.receipts).toBe(0); // the reported symptom: rollup finds nothing

    // Plain re-run today (no --clean): same deterministic ids, so nothing new
    // is inserted — but every existing receipt must be pulled back in-window.
    const second = await seedSpaceZapReceipts(events, nowSec);
    expect(second.inserted).toBe(0);
    expect(second.refreshed).toBe(first.inserted);

    const { total, inWindow } = await countReceipts();
    expect(total).toBe(first.inserted);
    expect(inWindow).toBe(total);

    const fresh = await discoveryService.rollupSpaceZaps();
    expect(fresh.receipts).toBe(first.inserted);
    expect(fresh.spaces).toBe(1);
  });

  it("reports rows actually written, not attempts", async () => {
    const events = await seedSpaceContent(12);
    const nowSec = Math.floor(Date.now() / 1000);

    const first = await seedSpaceZapReceipts(events, nowSec);
    const second = await seedSpaceZapReceipts(events, nowSec);

    // ~30% of events deterministically get no receipt, so a per-iteration
    // counter would overreport; both runs must agree with the table itself.
    const { total } = await countReceipts();
    expect(first.inserted + first.refreshed).toBe(total);
    expect(second.inserted + second.refreshed).toBe(total);
    expect(second.inserted).toBe(0);
  });

  it("refresh touches only created_at — id set, targets, and sats stay identical", async () => {
    const events = await seedSpaceContent(12);
    const nowSec = Math.floor(Date.now() / 1000);

    await seedSpaceZapReceipts(events, nowSec - 2 * 24 * 3600);
    const before = await readReceipts();

    await seedSpaceZapReceipts(events, nowSec);
    const after = await readReceipts();

    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].pubkey).toBe(before[i].pubkey);
      expect(after[i].kind).toBe(9735);
      expect(after[i].tags).toEqual(before[i].tags); // amount lives in tags
      expect(after[i].e_tags).toEqual(before[i].e_tags);
      expect(Number(after[i].created_at)).toBeGreaterThan(Number(before[i].created_at));
    }
  });

  it("every receipt is prefixed so --clean's LIKE delete removes exactly the synthetic rows", async () => {
    const events = await seedSpaceContent(12);
    const { inserted } = await seedSpaceZapReceipts(events, Math.floor(Date.now() / 1000));
    expect(inserted).toBeGreaterThan(0);

    const receipts = await readReceipts();
    expect(receipts).toHaveLength(inserted);
    for (const r of receipts) expect(r.id.startsWith(SEED_PREFIX)).toBe(true);

    // The --clean statement from the script: it must remove every receipt and
    // leave the real content rows alone.
    await db.execute(sql`DELETE FROM relay.events WHERE id LIKE ${SEED_PREFIX + "%"}`);

    expect((await countReceipts()).total).toBe(0);
    const [remaining] = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM relay.events
    `)) as unknown as Array<{ n: number }>;
    expect(Number(remaining.n)).toBe(events.length);
  });

  it("feeds per-space zap counts and discovery scores end to end", async () => {
    await seedSpaceRow("space-loud");
    await seedSpaceRow("space-quiet");

    // Content in both spaces, receipts seeded over both at once — the rollup
    // must attribute each receipt to the space its target is h-tagged to.
    const loud = await seedSpaceContent(10, "space-loud");
    const quiet = await seedSpaceContent(2, "space-quiet");
    const nowSec = Math.floor(Date.now() / 1000);

    const { inserted } = await seedSpaceZapReceipts([...loud, ...quiet], nowSec);
    expect(inserted).toBeGreaterThan(0);

    const rollup = await discoveryService.rollupSpaceZaps();
    expect(rollup.receipts).toBe(inserted);
    await discoveryService.computeDiscoveryScores();

    const [loudRow] = await db.select().from(spaces).where(eq(spaces.id, "space-loud")).limit(1);
    const [quietRow] = await db.select().from(spaces).where(eq(spaces.id, "space-quiet")).limit(1);

    // Per-space counts must sum to every receipt written, each with real sats.
    expect(loudRow.zapCount24h + quietRow.zapCount24h).toBe(inserted);
    expect(loudRow.zapCount24h).toBeGreaterThan(0);
    if (loudRow.zapCount24h > 0) expect(Number(loudRow.zapSats24h)).toBeGreaterThan(0);
    if (quietRow.zapCount24h > 0) expect(Number(quietRow.zapSats24h)).toBeGreaterThan(0);

    // And the zap term must reach the discovery score (both spaces are
    // otherwise identical: same member count, no activity, no recency bonus).
    if (loudRow.zapCount24h > quietRow.zapCount24h) {
      expect(loudRow.discoveryScore).toBeGreaterThan(quietRow.discoveryScore);
    }
  });
});
