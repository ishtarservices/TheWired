import { text, integer, bigint, timestamp, jsonb } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "nudity",
  "illegal",
  "impersonation",
  "malware",
  "copyright",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_TARGET_TYPES = ["event", "user", "dm", "voice", "track", "album"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export type ReportSource = "nostr" | "http";
export type ReportStatus = "open" | "actioned" | "dismissed";

/** Voice targets name a room / space; never message content. */
export interface ReportTargetContext {
  roomId?: string;
  spaceId?: string;
}

/** User reports (App Store 1.2) — migration 0030. Ids only, never the
 *  reported text: a DM report carries the gift-wrap id the operator cannot
 *  open, an event report the id the relay already holds. */
export const reports = appSchema.table("reports", {
  id: text("id").primaryKey(),
  source: text("source").$type<ReportSource>().notNull(),
  reporterPubkey: text("reporter_pubkey"),
  /** Keyed hash of a guest reporter's IP (config.reportIpSalt). */
  reporterIpHash: text("reporter_ip_hash"),
  targetType: text("target_type").$type<ReportTargetType>().notNull(),
  targetEventId: text("target_event_id"),
  targetCoordinate: text("target_coordinate"),
  targetPubkey: text("target_pubkey"),
  targetKind: integer("target_kind"),
  targetContext: jsonb("target_context").$type<ReportTargetContext>(),
  category: text("category").$type<ReportCategory>().notNull(),
  note: text("note"),
  /** The kind-1984 id for nostr reports (unique: re-ingest is a no-op). */
  reportEventId: text("report_event_id").unique(),
  status: text("status").$type<ReportStatus>().notNull().default("open"),
  /** The last action taken (dismiss | remove_event | remove_music | suspend_pubkey | escalate). */
  resolution: text("resolution"),
  resolutionNote: text("resolution_note"),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Reserved for automated triage (recommendations only, never verdicts). */
  triage: jsonb("triage").$type<Record<string, unknown>>(),
});

export type ReportRow = typeof reports.$inferSelect;

export type DeletionStatus = "pending" | "complete";
export type OwnedSpacesMode = "delete" | "orphan";

/** Account deletion tombstone (App Store 5.1.1(v)) — migration 0030. */
export const accountDeletions = appSchema.table("account_deletions", {
  pubkey: text("pubkey").primaryKey(),
  vanishEventId: text("vanish_event_id").notNull(),
  vanishCreatedAt: bigint("vanish_created_at", { mode: "number" }).notNull(),
  vanishEvent: jsonb("vanish_event").$type<Record<string, unknown>>().notNull(),
  ownedSpaces: text("owned_spaces").$type<OwnedSpacesMode>(),
  status: text("status").$type<DeletionStatus>().notNull().default("pending"),
  /** step name → rows removed, written as each step finishes. */
  steps: jsonb("steps").$type<Record<string, number>>().notNull().default({}),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
