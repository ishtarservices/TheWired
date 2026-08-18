import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { cachedProfiles } from "../../src/db/schema/profiles.js";
import { computeProfileStats } from "../../src/workers/profileStatsComputer.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";

/**
 * `note_count` is the only sortable attribute on the profiles index, so it is
 * what the q-less "people worth following" list is ordered by, and `has_nip05`
 * is the only filter the browse list offers. These tests pin down what counts
 * toward each — and, critically, that both are written as a PARTIAL update so a
 * later kind:0 edit cannot wipe them.
 */

let index: {
  updateDocuments: ReturnType<typeof vi.fn>;
};

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
  for (const col of ["h_tag TEXT", "visibility TEXT"]) {
    await db.execute(sql.raw(`ALTER TABLE relay.events ADD COLUMN IF NOT EXISTS ${col}`));
  }
  index = getMeilisearchClient().index("profiles") as never;
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM relay.events`);
  index.updateDocuments.mockClear();
});

/** The worker reads the known-profiles set from app.cached_profiles. */
async function seedProfile(pubkey: string, nip05?: string) {
  await db
    .insert(cachedProfiles)
    .values({ pubkey, nip05, fetchedAt: Date.now() })
    .onConflictDoNothing();
}

let seq = 0;
async function seedNote(opts: {
  pubkey: string;
  kind?: number;
  ageDays?: number;
  hTag?: string | null;
  visibility?: string | null;
}) {
  seq += 1;
  const id = `note${seq}`.padEnd(64, "0").slice(0, 64);
  await db.execute(sql`
    INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, h_tag, visibility)
    VALUES (${id}, ${opts.pubkey},
            ${Math.floor(Date.now() / 1000) - Math.floor((opts.ageDays ?? 0) * 86400)},
            ${opts.kind ?? 1}, '[]'::jsonb, 'hi', ${"0".repeat(128)},
            ${opts.hTag ?? null}, ${opts.visibility ?? null})
  `);
}

/** The documents the worker pushed, flattened across batches. */
function pushedDocs(): Array<{ pubkey: string; note_count: number; has_nip05: boolean }> {
  return index.updateDocuments.mock.calls.flatMap((call) => call[0]);
}

function countFor(pubkey: string): number | undefined {
  return pushedDocs().find((d) => d.pubkey === pubkey)?.note_count;
}

function nip05For(pubkey: string): boolean | undefined {
  return pushedDocs().find((d) => d.pubkey === pubkey)?.has_nip05;
}

describe("computeProfileStats", () => {
  it("counts public notes per author", async () => {
    await seedProfile(LUNA.pubkey);
    await seedProfile(MARCUS.pubkey);
    await seedNote({ pubkey: LUNA.pubkey });
    await seedNote({ pubkey: LUNA.pubkey });
    await seedNote({ pubkey: MARCUS.pubkey });

    const result = await computeProfileStats();
    expect(result.profiles).toBe(2);
    expect(countFor(LUNA.pubkey)).toBe(2);
    expect(countFor(MARCUS.pubkey)).toBe(1);
  });

  it("writes a PARTIAL update so kind:0 ingest fields survive", async () => {
    await seedProfile(LUNA.pubkey);
    await seedNote({ pubkey: LUNA.pubkey });
    await computeProfileStats();

    // Only the primary key and the two fields this worker owns.
    expect(pushedDocs()[0]).toEqual({
      pubkey: LUNA.pubkey,
      note_count: 1,
      has_nip05: false,
    });
  });

  it("only counts the trailing 30 days — the list is 'worth following now'", async () => {
    await seedProfile(LUNA.pubkey);
    await seedNote({ pubkey: LUNA.pubkey, ageDays: 1 });
    await seedNote({ pubkey: LUNA.pubkey, ageDays: 60 });
    await seedNote({ pubkey: LUNA.pubkey, ageDays: 400 });

    await computeProfileStats();
    expect(countFor(LUNA.pubkey)).toBe(1);
  });

  it("does not count space-scoped posts — they are not publicly readable", async () => {
    await seedProfile(LUNA.pubkey);
    await seedNote({ pubkey: LUNA.pubkey, hTag: "private-space" });
    await seedNote({ pubkey: LUNA.pubkey });

    await computeProfileStats();
    expect(countFor(LUNA.pubkey)).toBe(1);
  });

  it("does not count unlisted or private posts", async () => {
    await seedProfile(LUNA.pubkey);
    await seedNote({ pubkey: LUNA.pubkey, visibility: "unlisted" });
    await seedNote({ pubkey: LUNA.pubkey, visibility: "private" });

    await computeProfileStats();
    expect(countFor(LUNA.pubkey)).toBe(0);
  });

  it("counts kind:1 only, not reactions or profile edits", async () => {
    await seedProfile(SAGE.pubkey);
    await seedNote({ pubkey: SAGE.pubkey, kind: 7 });
    await seedNote({ pubkey: SAGE.pubkey, kind: 0 });

    await computeProfileStats();
    expect(countFor(SAGE.pubkey)).toBe(0);
  });

  it("includes a profile that has never posted, at note_count 0", async () => {
    await seedProfile(MARCUS.pubkey, "marcus@thewired.app");

    const result = await computeProfileStats();
    expect(result.profiles).toBe(1);
    expect(countFor(MARCUS.pubkey)).toBe(0);
  });

  it("backfills has_nip05 from the cached profile, not just from fresh kind:0 ingest", async () => {
    // The regression this guards: profiles indexed before has_nip05 existed
    // would never match `has_nip05 = true`, because Meilisearch does not match a
    // missing attribute.
    await seedProfile(LUNA.pubkey, "luna@thewired.app");
    await seedProfile(MARCUS.pubkey);

    await computeProfileStats();
    expect(nip05For(LUNA.pubkey)).toBe(true);
    expect(nip05For(MARCUS.pubkey)).toBe(false);
  });

  it("treats an empty nip05 string as unverified", async () => {
    await seedProfile(LUNA.pubkey, "");
    await computeProfileStats();
    expect(nip05For(LUNA.pubkey)).toBe(false);
  });

  it("pushes nothing when no profiles are known", async () => {
    const result = await computeProfileStats();
    expect(result).toEqual({ profiles: 0 });
    expect(index.updateDocuments).not.toHaveBeenCalled();
  });
});
