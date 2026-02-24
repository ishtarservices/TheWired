import { text, integer, bigint, timestamp } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const bans = appSchema.table("bans", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  pubkey: text("pubkey").notNull(),
  reason: text("reason"),
  bannedBy: text("banned_by").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timedMutes = appSchema.table("timed_mutes", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  pubkey: text("pubkey").notNull(),
  channelId: text("channel_id"),
  mutedBy: text("muted_by").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const spamReports = appSchema.table("spam_reports", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  reporterPubkey: text("reporter_pubkey").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reputation = appSchema.table("reputation", {
  pubkey: text("pubkey").primaryKey(),
  score: integer("score").notNull().default(100),
  lastUpdated: timestamp("last_updated").defaultNow(),
});
