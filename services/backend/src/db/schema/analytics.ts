import { text, integer, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const spaceActivityDaily = appSchema.table("space_activity_daily", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  uniqueAuthors: integer("unique_authors").notNull().default(0),
  newMembers: integer("new_members").notNull().default(0),
  leftMembers: integer("left_members").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.date] }),
]);

export const memberEngagement = appSchema.table("member_engagement", {
  spaceId: text("space_id").notNull(),
  pubkey: text("pubkey").notNull(),
  date: text("date").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  reactionsGiven: integer("reactions_given").notNull().default(0),
  reactionsReceived: integer("reactions_received").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.pubkey, t.date] }),
]);
