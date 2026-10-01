import { resolve, join } from "node:path";
import { rm, unlink } from "node:fs/promises";
import { eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db/connection.js";
import { accountDeletions, type OwnedSpacesMode } from "../db/schema/reports.js";
import { blobs, blobOwners } from "../db/schema/blobs.js";
import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { escapeMsFilter } from "../lib/meiliFilter.js";
import { verifyEvent } from "../lib/nostr/eventVerifier.js";
import { musicService } from "./musicService.js";
import { cloudflareTunnelService } from "./cloudflareTunnelService.js";

/**
 * Account deletion (App Store 5.1.1(v), NIP-62).
 *
 * Deletes what THIS operator controls: its database, relay, search index and
 * blob store. Copies on other relays are covered only by the user's
 * ALL_RELAYS NIP-62 request to vanish, which is a request and nothing more.
 *
 * Idempotent: `app.account_deletions` is the tombstone. Every step is a
 * delete-where, so a repeat call (or the boot-time resume) re-runs the whole
 * purge safely; step counts accumulate across runs.
 *
 * Retained on purpose (and why): the tombstone + kind 62 (proof of the request,
 * blocks re-ingest); bans / timed mutes targeting the pubkey (abuse prevention
 * in surviving spaces); moderation_audit_log, relay.tombstones and
 * relay.suspended_pubkeys (moderation / legal record); reports against the
 * pubkey; aggregate counters. Reports the user FILED keep their row with the
 * reporter nulled, and the reputation row is deleted (owner decision
 * 2026-09-30).
 */

export const KIND_VANISH = 62;
export const ALL_RELAYS = "ALL_RELAYS";
/** How far the signed kind 62 may be from now. */
export const VANISH_MAX_SKEW_SEC = 600;

const BLOB_DIR = resolve(process.cwd(), config.blobDir);

export interface VanishEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface Rejection {
  status: number;
  code: string;
  error: string;
}

function normalizeRelayUrl(u: string): string {
  return u.trim().toLowerCase().replace(/\/+$/, "");
}

/** Pure validation of the second proof of intent (the signed kind 62). */
export function validateVanishEvent(
  ev: VanishEvent,
  authedPubkey: string,
  nowSec: number,
  opts: { relayUrls?: string[]; checkFreshness?: boolean } = {},
): Rejection | null {
  if (!verifyEvent(ev)) {
    return { status: 400, code: "INVALID_EVENT", error: "vanishEvent signature does not verify" };
  }
  if (ev.pubkey !== authedPubkey) {
    return { status: 403, code: "FORBIDDEN", error: "vanishEvent is signed by another key" };
  }
  const relays = (opts.relayUrls ?? [config.publicRelayUrl]).map(normalizeRelayUrl);
  const targets = ev.tags.filter((t) => t[0] === "relay" && typeof t[1] === "string").map((t) => t[1]);
  const namesUs = targets.some((r) => r === ALL_RELAYS || relays.includes(normalizeRelayUrl(r)));
  if (ev.kind !== KIND_VANISH || !namesUs) {
    return {
      status: 400,
      code: "INVALID_VANISH_TARGET",
      error: "vanishEvent must be kind 62 with a relay tag naming this relay or ALL_RELAYS",
    };
  }
  if ((opts.checkFreshness ?? true) && Math.abs(nowSec - ev.created_at) > VANISH_MAX_SKEW_SEC) {
    return { status: 400, code: "STALE_EVENT", error: "vanishEvent created_at is more than 10 minutes off" };
  }
  return null;
}

/** Spaces the pubkey created (and would orphan or delete). */
export async function spacesCreatedBy(pubkey: string): Promise<Array<{ id: string; name: string }>> {
  return (await db.execute(
    sql`SELECT id, name FROM app.spaces WHERE creator_pubkey = ${pubkey} ORDER BY id`,
  )) as unknown as Array<{ id: string; name: string }>;
}

/** Rows a data-modifying statement touched, without shipping them back. */
async function affected(statement: SQL, runner: { execute: typeof db.execute } = db): Promise<number> {
  const rows = (await runner.execute(
    sql`WITH d AS (${statement} RETURNING 1) SELECT COUNT(*)::int AS n FROM d`,
  )) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

async function delRedisPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  let cursor = "0";
  let n = 0;
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    if (keys.length > 0) n += await redis.del(...keys);
  } while (cursor !== "0");
  return n;
}

type StepFn = (pubkey: string, row: DeletionRow) => Promise<number>;
type DeletionRow = typeof accountDeletions.$inferSelect;

/** The purge, in the order the spec lists it. */
const STEPS: Array<[string, StepFn]> = [
  // 2. Outbound contact — nothing may reach this person any more.
  [
    "outbound",
    async (pk) => {
      let n = 0;
      n += await affected(sql`DELETE FROM app.push_devices WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.push_subscriptions WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.notification_queue WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.notification_preferences WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.watched_by WHERE author_pubkey = ${pk} OR watcher_pubkey = ${pk}`);
      n += await affected(
        sql`UPDATE app.notification_preferences SET watched_pubkeys = watched_pubkeys - ${pk}
            WHERE watched_pubkeys ? ${pk}`,
      );
      n += await delRedisPattern(`notif:*:${pk}`);
      n += await delRedisPattern(`notif:*:${pk}:*`);
      return n;
    },
  ],
  // 3. Identity.
  [
    "identity",
    async (pk) => {
      let n = 0;
      n += await affected(sql`DELETE FROM app.nip05_identities WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.cached_profiles WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.reputation WHERE pubkey = ${pk}`);
      // Reports this person filed stay (moderation record), reporter removed.
      n += await affected(sql`UPDATE app.reports SET reporter_pubkey = NULL WHERE reporter_pubkey = ${pk}`);
      try {
        await getMeilisearchClient().index("profiles").deleteDocument(pk);
      } catch {
        // not indexed
      }
      n += await cloudflareTunnelService.deprovision(pk);
      return n;
    },
  ],
  // 4. Owned spaces — per the caller's explicit choice.
  [
    "ownedSpaces",
    async (pk, row) => {
      if (row.ownedSpaces === "delete") {
        // Same as DELETE /spaces/:id: CASCADE clears channels, members, roles, invites, tags.
        return affected(sql`DELETE FROM app.spaces WHERE creator_pubkey = ${pk}`);
      }
      // Orphan: remaining MANAGE_SPACE holders keep it (authz's legacy fallback).
      return affected(sql`UPDATE app.spaces SET creator_pubkey = NULL WHERE creator_pubkey = ${pk}`);
    },
  ],
  // 5. Memberships.
  [
    "memberships",
    async (pk) => {
      let n = 0;
      // One statement: the count drops only for membership rows this run
      // actually deleted, so a retry or a concurrent run (the request and the
      // pending-deletion worker) can never decrement twice.
      const left = (await db.execute(
        sql`WITH gone AS (DELETE FROM app.space_members WHERE pubkey = ${pk} RETURNING space_id),
                 dec AS (UPDATE app.spaces SET member_count = GREATEST(member_count - 1, 0)
                         WHERE id IN (SELECT space_id FROM gone) RETURNING 1)
            SELECT COUNT(*)::int AS n FROM gone`,
      )) as unknown as Array<{ n: number }>;
      n += left[0]?.n ?? 0;
      n += await affected(sql`DELETE FROM app.member_roles WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.member_onboarding_state WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.member_engagement WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.space_feed_sources WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.invites WHERE created_by = ${pk}`);
      n += await affected(sql`DELETE FROM app.pinned_messages WHERE pinned_by = ${pk}`);
      n += await affected(sql`DELETE FROM app.scheduled_messages WHERE scheduled_by = ${pk}`);
      n += await affected(sql`DELETE FROM relay.group_members WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM relay.group_roles WHERE pubkey = ${pk}`);
      return n;
    },
  ],
  // 6. Music — as an artist through the existing deleteMusic cleanup, then as
  //    a listener.
  [
    "music",
    async (pk) => {
      let n = 0;
      const owned = (await db.execute(
        sql`SELECT DISTINCT kind, d_tag FROM relay.events
            WHERE pubkey = ${pk} AND kind IN (31683, 33123) AND d_tag IS NOT NULL`,
      )) as unknown as Array<{ kind: number; d_tag: string }>;
      for (const m of owned) {
        if (await musicService.deleteMusic(m.kind, pk, m.d_tag)) n += 1;
      }
      n += await affected(sql`DELETE FROM relay.events WHERE pubkey = ${pk} AND kind IN (30119, 31685)`);
      n += await affected(sql`DELETE FROM app.music_uploads WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.music_revisions WHERE pubkey = ${pk}`);
      n += await affected(sql`DELETE FROM app.saved_album_versions WHERE pubkey = ${pk}`);
      n += await affected(
        sql`DELETE FROM app.music_proposals WHERE proposer_pubkey = ${pk} OR owner_pubkey = ${pk}`,
      );
      n += await affected(sql`DELETE FROM app.music_play_listeners WHERE pubkey = ${pk}`);
      n += await getRedis().del(`listening_history:${pk}`, `personalized:${pk}:feed`);
      return n;
    },
  ],
  // 7. Blobs — ownership, then any blob nobody else owns (file, HLS, row).
  [
    "blobs",
    async (pk) => {
      const owned = await db
        .delete(blobOwners)
        .where(eq(blobOwners.pubkey, pk))
        .returning({ sha256: blobOwners.sha256 });
      for (const { sha256 } of owned) {
        const [other] = await db.select().from(blobOwners).where(eq(blobOwners.sha256, sha256)).limit(1);
        if (other) continue;
        await unlink(join(BLOB_DIR, sha256)).catch(() => {});
        await rm(join(BLOB_DIR, "hls", sha256), { recursive: true, force: true }).catch(() => {});
        await db.delete(blobs).where(eq(blobs.sha256, sha256));
      }
      return owned.length;
    },
  ],
  // 8. Relay events, in one transaction: everything authored up to the
  //    vanish, and every gift wrap addressed to the pubkey. Then the search
  //    documents.
  [
    "relayEvents",
    async (pk, row) => {
      const n = await db.transaction(async (tx) => {
        // The kind 62 itself stays: it is the request other relays and clients
        // act on, and the proof that this relay honoured it.
        const authored = await affected(
          sql`DELETE FROM relay.events
              WHERE pubkey = ${pk} AND created_at <= ${row.vanishCreatedAt} AND kind <> ${KIND_VANISH}`,
          tx,
        );
        const wraps = await affected(
          sql`DELETE FROM relay.events WHERE kind = 1059 AND p_tags @> ARRAY[${pk}]::text[]`,
          tx,
        );
        return authored + wraps;
      });
      const ms = getMeilisearchClient();
      const filter = `pubkey = "${escapeMsFilter(pk)}"`;
      for (const index of ["events", "tracks", "albums"]) {
        await ms.index(index).deleteDocuments({ filter });
      }
      return n;
    },
  ],
];

export interface DeletionOutcome {
  status: "pending" | "complete";
  requestedAt: string;
  completedAt?: string;
  deleted: Record<string, number>;
}

function outcome(row: DeletionRow): DeletionOutcome {
  const out: DeletionOutcome = {
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    deleted: row.steps ?? {},
  };
  if (row.completedAt) out.completedAt = row.completedAt.toISOString();
  return out;
}

const deletedCache: { map: Map<string, number>; at: number } = { map: new Map(), at: 0 };
const DELETED_CACHE_TTL_MS = 30_000;

export const accountDeletionService = {
  async get(pubkey: string): Promise<DeletionRow | null> {
    const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, pubkey)).limit(1);
    return row ?? null;
  },

  outcome,

  /** Record the request (first call only) and run the purge. */
  async request(pubkey: string, vanishEvent: VanishEvent, ownedSpaces: OwnedSpacesMode | null): Promise<DeletionOutcome> {
    await db
      .insert(accountDeletions)
      .values({
        pubkey,
        vanishEventId: vanishEvent.id,
        vanishCreatedAt: vanishEvent.created_at,
        vanishEvent: vanishEvent as unknown as Record<string, unknown>,
        ownedSpaces,
      })
      .onConflictDoNothing();
    let row = await this.get(pubkey);
    if (!row) throw new Error("account deletion tombstone missing after insert");
    // A repeat request with a NEWER vanish moves the cutoff forward and re-runs
    // the purge: whatever the account published between the two requests
    // (a client still signed in, a retry that re-signed) goes too, and the
    // blank kind 0 the client publishes right after (vanish − 1) falls inside
    // the cutoff, so the ingester does not re-create the profile.
    if (vanishEvent.created_at > row.vanishCreatedAt) {
      [row] = await db
        .update(accountDeletions)
        .set({
          vanishEventId: vanishEvent.id,
          vanishCreatedAt: vanishEvent.created_at,
          vanishEvent: vanishEvent as unknown as Record<string, unknown>,
          ownedSpaces: ownedSpaces ?? row.ownedSpaces,
          status: "pending",
          completedAt: null,
        })
        .where(eq(accountDeletions.pubkey, pubkey))
        .returning();
    } else if (ownedSpaces && !row.ownedSpaces && row.status !== "complete") {
      // A retry of a pending deletion that now carries the spaces choice.
      [row] = await db
        .update(accountDeletions)
        .set({ ownedSpaces })
        .where(eq(accountDeletions.pubkey, pubkey))
        .returning();
    }
    this.invalidate();
    if (row.status === "complete") return outcome(row);
    return outcome(await this.run(row));
  },

  /** Run every step; complete only when none failed. */
  async run(row: DeletionRow): Promise<DeletionRow> {
    const steps: Record<string, number> = { ...(row.steps ?? {}) };
    let failed = false;
    for (const [name, step] of STEPS) {
      try {
        steps[name] = (steps[name] ?? 0) + (await step(row.pubkey, row));
      } catch (err) {
        failed = true;
        console.error(`[account-deletion] step ${name} failed for ${row.pubkey.slice(0, 12)}…:`, (err as Error).message);
      }
      await db.update(accountDeletions).set({ steps }).where(eq(accountDeletions.pubkey, row.pubkey));
    }
    const [updated] = await db
      .update(accountDeletions)
      .set(failed ? { steps } : { steps, status: "complete", completedAt: new Date() })
      .where(eq(accountDeletions.pubkey, row.pubkey))
      .returning();
    return updated;
  },

  /** Boot-time: finish any deletion a crash or a failed step left pending. */
  async resumePending(): Promise<number> {
    const pending = await db.select().from(accountDeletions).where(eq(accountDeletions.status, "pending"));
    for (const row of pending) await this.run(row);
    return pending.length;
  },

  /** Forget the cached deleted-accounts map. */
  invalidate(): void {
    deletedCache.at = 0;
  },

  /**
   * Deleted pubkey → vanish created_at, cached ≤ 30 s, for the ingester's
   * re-ingest block. Fails open to "none" (a schema hiccup must not stop ingest).
   */
  async deletedVanishTimes(): Promise<Map<string, number>> {
    if (Date.now() - deletedCache.at < DELETED_CACHE_TTL_MS) return deletedCache.map;
    try {
      const rows = await db
        .select({ pubkey: accountDeletions.pubkey, at: accountDeletions.vanishCreatedAt })
        .from(accountDeletions);
      deletedCache.map = new Map(rows.map((r) => [r.pubkey, Number(r.at)]));
    } catch {
      // keep the previous map
    }
    deletedCache.at = Date.now();
    return deletedCache.map;
  },
};
