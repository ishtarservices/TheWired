import { db } from "../db/connection.js";
import { spaceActivityDaily, memberEngagement } from "../db/schema/analytics.js";
import { spaces } from "../db/schema/spaces.js";
import { eq, sql } from "drizzle-orm";

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

/** Daily analytics rollup */
export function startAnalyticsAggregator() {
  async function aggregate() {
    console.log("[analytics] Running daily aggregation...");

    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];
      const dayStart = Math.floor(yesterday.setHours(0, 0, 0, 0) / 1000);
      const dayEnd = dayStart + 86400;

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

        // Update space stats
        await db
          .update(spaces)
          .set({
            messagesLast24h: row.message_count,
            activeMembers24h: row.unique_authors,
          })
          .where(eq(spaces.id, row.h_tag));
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

  // Run every 24 hours
  setInterval(aggregate, 24 * 60 * 60 * 1000);
  // Delay first run by 60s to let other services start
  setTimeout(aggregate, 60_000);
}
