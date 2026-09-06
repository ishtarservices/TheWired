import { db } from "../db/connection.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { sql } from "drizzle-orm";
import { startLockedInterval } from "../lib/workerLock.js";

interface ActivityRow {
  h_tag: string;
  message_count: number;
  unique_authors: number;
  join_count: number;
  leave_count: number;
}

interface MemberRow {
  h_tag: string;
  pubkey: string;
  message_count: number;
  reaction_count: number;
}

interface ReactionsReceivedRow {
  h_tag: string;
  pubkey: string;
  reactions_received: number;
}

/** One fully-recomputed member_engagement row for a single space/pubkey/day. */
export interface MemberEngagementTotals {
  spaceId: string;
  pubkey: string;
  messageCount: number;
  reactionsGiven: number;
  reactionsReceived: number;
}

/**
 * Combine the two per-member aggregates into the rows written to
 * member_engagement.
 *
 * `reactions_received` is keyed by the reaction's *recipient*, so it covers
 * pubkeys that authored nothing that day and therefore never appear in the
 * activity aggregate. Outer-joining the two in SQL is possible but obscures
 * that; merging here keeps it obvious and lets the reconciliation be tested
 * without a database.
 *
 * Pure: no DB, no clock.
 */
export function mergeMemberEngagement(
  activity: MemberRow[],
  received: ReactionsReceivedRow[],
): MemberEngagementTotals[] {
  const rows = new Map<string, MemberEngagementTotals>();

  const rowFor = (spaceId: string, pubkey: string): MemberEngagementTotals => {
    const key = `${spaceId}\u0000${pubkey}`;
    let row = rows.get(key);
    if (!row) {
      row = { spaceId, pubkey, messageCount: 0, reactionsGiven: 0, reactionsReceived: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const r of activity) {
    if (!r.h_tag || !r.pubkey) continue;
    const row = rowFor(r.h_tag, r.pubkey);
    row.messageCount = r.message_count;
    row.reactionsGiven = r.reaction_count;
  }

  for (const r of received) {
    if (!r.h_tag || !r.pubkey) continue;
    rowFor(r.h_tag, r.pubkey).reactionsReceived = r.reactions_received;
  }

  return [...rows.values()];
}

/**
 * Daily history rollup: space_activity_daily + member_engagement for
 * yesterday's UTC calendar day. The rolling app.spaces stats columns are owned
 * by refreshRollingStats(), not this pass.
 */
export async function runDailyAggregation(): Promise<void> {
  console.log("[analytics] Running daily aggregation...");

  try {
    // Both the row key (dateStr) and the window are UTC so they always agree.
    const todayUtcMidnight = new Date();
    todayUtcMidnight.setUTCHours(0, 0, 0, 0);
    const dayEnd = Math.floor(todayUtcMidnight.getTime() / 1000);
    const dayStart = dayEnd - 86_400;
    const dateStr = new Date(dayStart * 1000).toISOString().split("T")[0];

    // Aggregate space activity from relay.events for yesterday
    const activity = (await db.execute(
      sql`SELECT
            h_tag,
            COUNT(*) FILTER (WHERE kind IN (1, 9))::int AS message_count,
            COUNT(DISTINCT pubkey) FILTER (WHERE kind IN (1, 9))::int AS unique_authors,
            COUNT(*) FILTER (WHERE kind = 9021)::int AS join_count,
            COUNT(*) FILTER (WHERE kind = 9022)::int AS leave_count
          FROM relay.events
          WHERE created_at >= ${dayStart}
            AND created_at < ${dayEnd}
            AND h_tag IS NOT NULL
          GROUP BY h_tag`,
    )) as unknown as ActivityRow[];

    for (const row of activity) {
      if (!row.h_tag) continue;

      // Upsert into space_activity_daily
      await db
        .insert(spaceActivityDaily)
        .values({
          spaceId: row.h_tag,
          date: dateStr,
          messageCount: row.message_count,
          uniqueAuthors: row.unique_authors,
          newMembers: row.join_count,
          leftMembers: row.leave_count,
        })
        .onConflictDoUpdate({
          target: [spaceActivityDaily.spaceId, spaceActivityDaily.date],
          set: {
            messageCount: row.message_count,
            uniqueAuthors: row.unique_authors,
            newMembers: row.join_count,
            leftMembers: row.leave_count,
          },
        });
    }

    // Aggregate per-member engagement
    const members = (await db.execute(
      sql`SELECT
            h_tag,
            pubkey,
            COUNT(*) FILTER (WHERE kind IN (1, 9))::int AS message_count,
            COUNT(*) FILTER (WHERE kind = 7)::int AS reaction_count
          FROM relay.events
          WHERE created_at >= ${dayStart}
            AND created_at < ${dayEnd}
            AND h_tag IS NOT NULL
          GROUP BY h_tag, pubkey`,
    )) as unknown as MemberRow[];

    // Reactions RECEIVED, keyed by the reaction's first `p` tag — the same
    // recipient the live ingest path picks (ingestHandlers.indexReaction).
    //
    // This column previously had two writers that disagreed: ingest incremented
    // it per event while this rollup rewrote the row around it, leaving a value
    // that no pass owned and that a replayed reaction inflated for good. The
    // daily rollup is the authority for every member_engagement column, so it
    // recomputes this one too; the ingest increment stays as the provisional
    // intra-day value, corrected here on the next pass like the other columns.
    const reactionsReceived = (await db.execute(
      sql`SELECT h_tag, p_tag AS pubkey, COUNT(*)::int AS reactions_received
          FROM (
            SELECT h_tag,
                   (SELECT elem->>1
                      FROM jsonb_array_elements(tags) AS elem
                     WHERE elem->>0 = 'p'
                     LIMIT 1) AS p_tag
            FROM relay.events
            WHERE kind = 7
              AND created_at >= ${dayStart}
              AND created_at < ${dayEnd}
              AND h_tag IS NOT NULL
          ) r
          WHERE p_tag IS NOT NULL
          GROUP BY h_tag, p_tag`,
    )) as unknown as ReactionsReceivedRow[];

    const engagement = mergeMemberEngagement(members, reactionsReceived);

    for (const row of engagement) {
      await db
        .insert(memberEngagement)
        .values({
          spaceId: row.spaceId,
          pubkey: row.pubkey,
          date: dateStr,
          messageCount: row.messageCount,
          reactionsGiven: row.reactionsGiven,
          reactionsReceived: row.reactionsReceived,
        })
        .onConflictDoUpdate({
          target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
          set: {
            messageCount: row.messageCount,
            reactionsGiven: row.reactionsGiven,
            reactionsReceived: row.reactionsReceived,
          },
        });
    }

    console.log(
      `[analytics] Aggregated ${activity.length} spaces, ${engagement.length} member entries for ${dateStr}`,
    );
  } catch (err) {
    console.error("[analytics] Aggregation error:", (err as Error).message);
  }
}

/**
 * Rolling 24h stats: recompute app.spaces.messages_last_24h and
 * active_members_24h over created_at >= now-86400. Single set-based statement:
 * every space is LEFT JOINed against the aggregate so spaces with no activity
 * in the window are zeroed rather than left stale. The IS DISTINCT FROM guard
 * skips rewriting rows whose values are unchanged.
 */
export async function refreshRollingStats(): Promise<void> {
  try {
    const windowStart = Math.floor(Date.now() / 1000) - 86_400;
    await db.execute(
      sql`WITH agg AS (
            SELECT
              h_tag,
              COUNT(*) FILTER (WHERE kind IN (1, 9))::int AS message_count,
              COUNT(DISTINCT pubkey) FILTER (WHERE kind IN (1, 9))::int AS unique_authors
            FROM relay.events
            WHERE created_at >= ${windowStart}
              AND kind IN (1, 9)
              AND h_tag IS NOT NULL
            GROUP BY h_tag
          )
          UPDATE app.spaces AS s
          SET
            messages_last_24h = COALESCE(a.message_count, 0),
            active_members_24h = COALESCE(a.unique_authors, 0)
          FROM app.spaces AS s2
          LEFT JOIN agg AS a ON a.h_tag = s2.id
          WHERE s.id = s2.id
            AND (s.messages_last_24h IS DISTINCT FROM COALESCE(a.message_count, 0)
              OR s.active_members_24h IS DISTINCT FROM COALESCE(a.unique_authors, 0))`,
    );
  } catch (err) {
    console.error("[analytics] Rolling stats error:", (err as Error).message);
  }
}

/** Daily analytics rollup + hourly rolling-window stats refresh */
export function startAnalyticsAggregator(): { stop: () => void } {
  // Daily history rollup every 24 hours (first run 60s after boot)
  const daily = startLockedInterval({
    name: "analyticsDailyAggregation",
    intervalMs: 24 * 60 * 60 * 1000,
    initialDelayMs: 60_000,
    // One hour is plenty for the pass and short enough that a crashed replica
    // does not block tomorrow's run.
    lockTtlMs: 60 * 60 * 1000,
    task: runDailyAggregation,
  });
  // Rolling 24h stats every hour (first run 90s after boot)
  const hourly = startLockedInterval({
    name: "analyticsRollingStats",
    intervalMs: 60 * 60 * 1000,
    initialDelayMs: 90_000,
    task: refreshRollingStats,
  });

  return {
    stop: () => {
      daily.stop();
      hourly.stop();
      console.log("[analytics] Stopped");
    },
  };
}
