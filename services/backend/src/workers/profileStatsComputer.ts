import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";
import { getMeilisearchClient } from "../lib/meilisearch.js";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
/** Meilisearch document batch size — keeps a single HTTP body reasonable. */
const BATCH_SIZE = 1000;

interface ProfileStatsRow {
  pubkey: string;
  note_count: number;
  has_nip05: boolean;
}

/**
 * Maintain the ranking fields on the Meilisearch `profiles` index.
 *
 * The profiles index is written by kind:0 ingest, which knows a profile's *text*
 * but nothing about whether anyone posts. Without a numeric field there is no
 * sortable attribute at all, so a people list can only ever be "whatever order
 * the search engine returned" — which is why `GET /search/people` needs this.
 *
 * `note_count` is deliberately a **30-day** count, not all-time: the list it
 * backs is "people worth following now", and an all-time count would freeze an
 * early-adopter ordering in place.
 *
 * `has_nip05` is re-derived here as well as at kind:0 ingest. Meilisearch will
 * not match `has_nip05 = true` against a document that simply lacks the
 * attribute, so profiles indexed before the field existed would be invisible to
 * the filter until their owner happened to republish a kind:0. Driving it off
 * app.cached_profiles (the same row ingest writes) makes it self-healing.
 */
export async function computeProfileStats(): Promise<{ profiles: number }> {
  const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

  // Every known profile, not just the ones who posted — a verified handle with
  // no recent notes still belongs in the has_nip05 filter, at note_count 0.
  // Public top-level notes only: space-scoped (h_tag) and unlisted/private posts
  // must not make someone look prolific on a public browse list.
  const rows = (await db.execute(sql`
    SELECT
      p.pubkey,
      COALESCE(n.note_count, 0)::int AS note_count,
      (p.nip05 IS NOT NULL AND p.nip05 <> '') AS has_nip05
    FROM app.cached_profiles p
    LEFT JOIN (
      SELECT pubkey, COUNT(*)::int AS note_count
      FROM relay.events
      WHERE kind = 1
        AND created_at >= ${since}
        AND h_tag IS NULL
        AND visibility IS NULL
      GROUP BY pubkey
    ) n ON n.pubkey = p.pubkey
  `)) as unknown as ProfileStatsRow[];

  if (rows.length === 0) return { profiles: 0 };

  const ms = getMeilisearchClient();
  const index = ms.index("profiles");

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
      pubkey: r.pubkey,
      note_count: Number(r.note_count),
      has_nip05: !!r.has_nip05,
    }));
    // Partial update: never clobber the name/about/nip05 fields ingest owns.
    await index.updateDocuments(batch);
  }

  return { profiles: rows.length };
}

export function startProfileStatsComputer(): { stop: () => void } {
  async function compute() {
    try {
      const { profiles } = await computeProfileStats();
      console.log(`[profileStats] Updated ranking fields for ${profiles} profiles`);
    } catch (err) {
      console.error("[profileStats] Error:", (err as Error).message);
    }
  }

  compute();
  const interval = setInterval(compute, INTERVAL_MS);

  console.log("[profileStats] Started (every 30 min)");

  return {
    stop: () => {
      clearInterval(interval);
      console.log("[profileStats] Stopped");
    },
  };
}
