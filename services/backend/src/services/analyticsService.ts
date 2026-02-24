import { db } from "../db/connection.js";
import { spaceActivityDaily } from "../db/schema/analytics.js";
import { eq, gte, and } from "drizzle-orm";

function periodToDate(period: string): string {
  const now = new Date();
  switch (period) {
    case "24h":
      now.setDate(now.getDate() - 1);
      break;
    case "7d":
      now.setDate(now.getDate() - 7);
      break;
    case "30d":
      now.setDate(now.getDate() - 30);
      break;
    default:
      now.setDate(now.getDate() - 7);
  }
  return now.toISOString().split("T")[0];
}

export const analyticsService = {
  async getSpaceAnalytics(spaceId: string, period: string) {
    const sinceDate = periodToDate(period);

    const activity = await db
      .select()
      .from(spaceActivityDaily)
      .where(
        and(
          eq(spaceActivityDaily.spaceId, spaceId),
          gte(spaceActivityDaily.date, sinceDate),
        ),
      )
      .limit(30);

    return {
      spaceId,
      period,
      dailyActivity: activity,
    };
  },
};
