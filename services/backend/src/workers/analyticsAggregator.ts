import { db } from "../db/connection.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { sql } from "drizzle-orm";

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

    for (const row of members) {
      if (!row.h_tag) continue;

      await db
        .insert(memberEngagement)
        .values({
          spaceId: row.h_tag,
          pubkey: row.pubkey,
          date: dateStr,
          messageCount: row.message_count,
          reactionsGiven: row.reaction_count,
          reactionsReceived: 0,
        })
        .onConflictDoUpdate({
          target: [memberEngagement.spaceId, memberEngagement.pubkey, memberEngagement.date],
          set: {
            messageCount: row.message_count,
            reactionsGiven: row.reaction_count,
          },
        });
    }

    console.log(
      `[analytics] Aggregated ${activity.length} spaces, ${members.length} member entries for ${dateStr}`,
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
  const dailyInterval = setInterval(runDailyAggregation, 24 * 60 * 60 * 1000);
  const dailyInitial = setTimeout(runDailyAggregation, 60_000);
  // Rolling 24h stats every hour (first run 90s after boot)
  const hourlyInterval = setInterval(refreshRollingStats, 60 * 60 * 1000);
  const hourlyInitial = setTimeout(refreshRollingStats, 90_000);

  return {
    stop: () => {
      clearInterval(dailyInterval);
      clearTimeout(dailyInitial);
      clearInterval(hourlyInterval);
      clearTimeout(hourlyInitial);
      console.log("[analytics] Stopped");
    },
  };
}
