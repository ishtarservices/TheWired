import { text, bigint, boolean, timestamp } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const pinnedMessages = appSchema.table("pinned_messages", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  eventId: text("event_id").notNull(),
  pinnedBy: text("pinned_by").notNull(),
  pinnedAt: timestamp("pinned_at").defaultNow(),
});

export const scheduledMessages = appSchema.table("scheduled_messages", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  content: text("content").notNull(),
  kind: bigint("kind", { mode: "number" }).notNull().default(9),
  scheduledBy: text("scheduled_by").notNull(),
  scheduledAt: bigint("scheduled_at", { mode: "number" }).notNull(),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});
