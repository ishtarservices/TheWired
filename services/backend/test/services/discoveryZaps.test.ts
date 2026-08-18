import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { discoveryService } from "../../src/services/discoveryService.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

/**
 * DB-backed tests for the per-space zap rollup and its effect on the discovery
 * score. relay.events is normally created by the Rust relay; here we create a
 * minimal version (same pattern as test/workers/analyticsAggregator.test.ts).
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

let seq = 0;
function nextId(label: string): string {
  seq += 1;
  return `${label}${seq}`.padEnd(64, "0").slice(0, 64);
}

async function seedSpace(id: string, opts: { listed?: boolean; members?: number } = {}) {
  await db.insert(spaces).values({
    id,
    hostRelay: "wss://relay.test.com",
    name: `Space ${id}`,
    listed: opts.listed ?? true,
    memberCount: opts.members ?? 0,
    createdAt: Math.floor(Date.now() / 1000) - 90 * 24 * 3600, // old: no recency bonus
  });
}

/** A space-scoped content event that a zap can target. */
async function seedSpaceContent(hTag: string): Promise<string> {
  const id = nextId("content");
  await db.execute(sql`
    INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, h_tag, e_tags)
    VALUES (${id}, ${LUNA.pubkey}, ${Math.floor(Date.now() / 1000)}, 1, '[]'::jsonb, 'hi',
            ${"0".repeat(128)}, ${hTag}, '{}')
  `);
  return id;
}

async function seedZapReceipt(targetId: string, sats: number, ageSeconds = 60) {
  const id = nextId("zap");
  const request = JSON.stringify({ kind: 9734, tags: [["amount", String(sats * 1000)]] });
  await db.execute(sql`
    INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, e_tags)
    VALUES (
      ${id}, ${MARCUS.pubkey}, ${Math.floor(Date.now() / 1000) - ageSeconds}, 9735,
      ${JSON.stringify([
        ["e", targetId],
        ["bolt11", "lnbc1..."],
        ["description", request],
      ])}::jsonb,
      '', ${"0".repeat(128)}, ARRAY[${targetId}]::text[]
    )
  `);
}

async function readSpace(id: string) {
  const [row] = await db.select().from(spaces).where(eq(spaces.id, id)).limit(1);
  return row;
}

describe("discoveryService.rollupSpaceZaps", () => {
  it("rolls zaps up to the space their target event is h-tagged to", async () => {
    await seedSpace("space-a");
    await seedSpace("space-b");

    const aEvent = await seedSpaceContent("space-a");
    const bEvent = await seedSpaceContent("space-b");

    await seedZapReceipt(aEvent, 100);
    await seedZapReceipt(aEvent, 250);
    await seedZapReceipt(bEvent, 21);

    const result = await discoveryService.rollupSpaceZaps();
    expect(result.receipts).toBe(3);
    expect(result.spaces).toBe(2);

    const a = await readSpace("space-a");
    expect(a.zapCount24h).toBe(2);
    expect(Number(a.zapSats24h)).toBe(350);

    const b = await readSpace("space-b");
    expect(b.zapCount24h).toBe(1);
    expect(Number(b.zapSats24h)).toBe(21);
  });

  it("ignores zaps that fell out of the 24h window", async () => {
    await seedSpace("space-a");
    const event = await seedSpaceContent("space-a");

    await seedZapReceipt(event, 500, 60); // in window
    await seedZapReceipt(event, 900, 48 * 3600); // 2 days ago

    await discoveryService.rollupSpaceZaps();

    const a = await readSpace("space-a");
    expect(a.zapCount24h).toBe(1);
    expect(Number(a.zapSats24h)).toBe(500);
  });

  it("resets a space back to zero once its zaps age out", async () => {
    await seedSpace("space-a");
    const event = await seedSpaceContent("space-a");
    await seedZapReceipt(event, 400);

    await discoveryService.rollupSpaceZaps();
    expect((await readSpace("space-a")).zapCount24h).toBe(1);

    // Same receipts, but now all outside the window.
    await discoveryService.rollupSpaceZaps(0);

    const a = await readSpace("space-a");
    expect(a.zapCount24h).toBe(0);
    expect(Number(a.zapSats24h)).toBe(0);
  });

  it("does not double-count when the rollup runs repeatedly", async () => {
    await seedSpace("space-a");
    const event = await seedSpaceContent("space-a");
    await seedZapReceipt(event, 100);

    await discoveryService.rollupSpaceZaps();
    await discoveryService.rollupSpaceZaps();
    await discoveryService.rollupSpaceZaps();

    const a = await readSpace("space-a");
    expect(a.zapCount24h).toBe(1);
    expect(Number(a.zapSats24h)).toBe(100);
  });

  it("ignores zaps on events that belong to no space", async () => {
    await seedSpace("space-a");

    const globalId = nextId("global");
    await db.execute(sql`
      INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, e_tags)
      VALUES (${globalId}, ${LUNA.pubkey}, ${Math.floor(Date.now() / 1000)}, 1, '[]'::jsonb, 'hi',
              ${"0".repeat(128)}, '{}')
    `);
    await seedZapReceipt(globalId, 9999);

    const result = await discoveryService.rollupSpaceZaps();
    expect(result.receipts).toBe(0);
    expect((await readSpace("space-a")).zapCount24h).toBe(0);
  });

  it("counts an unsettled receipt but credits it zero sats", async () => {
    await seedSpace("space-a");
    const event = await seedSpaceContent("space-a");

    const id = nextId("zap");
    await db.execute(sql`
      INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, e_tags)
      VALUES (${id}, ${MARCUS.pubkey}, ${Math.floor(Date.now() / 1000)}, 9735,
              ${JSON.stringify([["e", event]])}::jsonb, '', ${"0".repeat(128)},
              ARRAY[${event}]::text[])
    `);

    await discoveryService.rollupSpaceZaps();

    const a = await readSpace("space-a");
    expect(a.zapCount24h).toBe(1);
    expect(Number(a.zapSats24h)).toBe(0);
  });
});

describe("discoveryService.computeDiscoveryScores", () => {
  it("ranks a zapped space above an equally-active unzapped one", async () => {
    await seedSpace("quiet-money", { members: 10 });
    await seedSpace("quiet-broke", { members: 10 });

    const event = await seedSpaceContent("quiet-money");
    await seedZapReceipt(event, 1000);

    await discoveryService.rollupSpaceZaps();
    await discoveryService.computeDiscoveryScores();

    const zapped = await readSpace("quiet-money");
    const unzapped = await readSpace("quiet-broke");
    expect(zapped.discoveryScore).toBeGreaterThan(unzapped.discoveryScore);
  });

  it("weights many small zaps over one large one (log on sats, linear on count)", async () => {
    await seedSpace("many-small", { members: 5 });
    await seedSpace("one-whale", { members: 5 });

    const small = await seedSpaceContent("many-small");
    for (let i = 0; i < 5; i++) await seedZapReceipt(small, 21);

    const whale = await seedSpaceContent("one-whale");
    await seedZapReceipt(whale, 100_000);

    await discoveryService.rollupSpaceZaps();
    await discoveryService.computeDiscoveryScores();

    expect((await readSpace("many-small")).discoveryScore).toBeGreaterThan(
      (await readSpace("one-whale")).discoveryScore,
    );
  });

  it("leaves unlisted spaces alone", async () => {
    await seedSpace("hidden", { listed: false, members: 500 });
    await discoveryService.computeDiscoveryScores();
    expect((await readSpace("hidden")).discoveryScore).toBe(0);
  });

  it("produces an integer score even with the logarithmic sats term", async () => {
    await seedSpace("space-a", { members: 3 });
    const event = await seedSpaceContent("space-a");
    await seedZapReceipt(event, 777);

    await discoveryService.rollupSpaceZaps();
    await discoveryService.computeDiscoveryScores();

    const score = (await readSpace("space-a")).discoveryScore;
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});
