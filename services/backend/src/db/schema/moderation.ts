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

// app.spam_reports was retired by migration 0030 (rows moved to app.reports,
// see schema/reports.ts).

export const reputation = appSchema.table("reputation", {
  pubkey: text("pubkey").primaryKey(),
  score: integer("score").notNull().default(100),
  lastUpdated: timestamp("last_updated").defaultNow(),
});

/** Audit log for moderation and role management actions (migration 0030).
 *  `spaceId` is null for platform-level actions (report resolutions:
 *  report_dismiss, report_remove_event, report_remove_music,
 *  report_suspend_pubkey, report_escalate, suspension_lift, event_restore). */
export const moderationAuditLog = appSchema.table("moderation_audit_log", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").references(() => spaces.id, { onDelete: "cascade" }),
  actorPubkey: text("actor_pubkey").notNull(),
  action: text("action").notNull(), // ban, unban, mute, unmute, kick, role_assign, role_remove, override_change, report_*
  targetPubkey: text("target_pubkey"),
  details: text("details"), // JSON blob with extra context (reason, roleId, channelId, etc.)
  createdAt: timestamp("created_at").defaultNow(),
});
