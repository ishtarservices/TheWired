import { db } from "../db/connection.js";
import { sql } from "drizzle-orm";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { startLockedInterval } from "../lib/workerLock.js";
import { suspensionService } from "../services/suspensionService.js";

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
/** Meilisearch document batch size — keeps a single HTTP body reasonable. */
const BATCH_SIZE = 1000;

/**
 * What this process last pushed per pubkey (`note_count:has_nip05`). Rewriting
 * every known profile each run made the profiles index re-index the whole set
 * every 30 minutes — a burst that grows with the profile cache, not with use —
 * so only rows whose values moved are pushed. In-memory on purpose: a restart
 * (or the lock moving to another instance) starts empty and re-pushes once,
 * which also heals any documents the engine lost while this process ran.
 */
const pushed = new Map<string, string>();

/** Forget what was pushed, so the next run writes every profile again. */
export function invalidateProfileStatsCache(): void {
  pushed.clear();
}

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
export async function computeProfileStats(): Promise<{ profiles: number; pushed: number }> {
  const since = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;

  // Every known profile, not just the ones who posted — a verified handle with
  // no recent notes still belongs in the has_nip05 filter, at note_count 0.
  // Public top-level notes only: space-scoped (h_tag) and unlisted/private posts
  // must not make someone look prolific on a public browse list.
  const allRows = (await db.execute(sql`
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
  // A suspended account's profile document was purged from search; a partial
  // update here would re-create it (updateDocuments upserts).
  const rows = await suspensionService.withoutSuspended(allRows, (r) => r.pubkey);

  // Profiles that left the set (suspended, deleted) are forgotten, so one that
  // comes back is pushed again rather than assumed current.
  const known = new Set(rows.map((r) => r.pubkey));
  for (const pubkey of pushed.keys()) {
    if (!known.has(pubkey)) pushed.delete(pubkey);
  }

  if (rows.length === 0) return { profiles: 0, pushed: 0 };

  const changed = rows
    .map((r) => ({
      pubkey: r.pubkey,
      note_count: Number(r.note_count),
      has_nip05: !!r.has_nip05,
    }))
    .filter((d) => pushed.get(d.pubkey) !== `${d.note_count}:${d.has_nip05}`);

  const ms = getMeilisearchClient();
  const index = ms.index("profiles");

  for (let i = 0; i < changed.length; i += BATCH_SIZE) {
    const batch = changed.slice(i, i + BATCH_SIZE);
    // Partial update: never clobber the name/about/nip05 fields ingest owns.
    await index.updateDocuments(batch);
    // Recorded only once the engine accepted the batch: a failed run leaves
    // these rows "changed", so the next run retries them.
    for (const d of batch) pushed.set(d.pubkey, `${d.note_count}:${d.has_nip05}`);
  }

  return { profiles: rows.length, pushed: changed.length };
}

export function startProfileStatsComputer(): { stop: () => void } {
  async function compute() {
    try {
      const { profiles, pushed: changed } = await computeProfileStats();
      console.log(`[profileStats] Updated ranking fields for ${changed} of ${profiles} profiles`);
    } catch (err) {
      console.error("[profileStats] Error:", (err as Error).message);
    }
  }

  const job = startLockedInterval({
    name: "profileStatsComputer",
    intervalMs: INTERVAL_MS,
    task: compute,
  });

  console.log("[profileStats] Started (every 30 min)");

  return {
    stop: () => {
      job.stop();
      console.log("[profileStats] Stopped");
    },
  };
}
