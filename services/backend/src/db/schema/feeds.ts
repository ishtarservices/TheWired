import { text, integer, timestamp } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const trendingSnapshots = appSchema.table("trending_snapshots", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  kind: integer("kind"),
  eventId: text("event_id").notNull(),
  score: integer("score").notNull(),
  computedAt: timestamp("computed_at").defaultNow(),
});
