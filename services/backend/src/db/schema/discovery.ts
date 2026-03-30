import { text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const listingRequests = appSchema.table("listing_requests", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  requesterPubkey: text("requester_pubkey").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  category: text("category"),
  tags: text("tags").array(),
  reason: text("reason"),
  reviewerPubkey: text("reviewer_pubkey"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
});

export const spaceCategories = appSchema.table("space_categories", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const relayDirectory = appSchema.table("relay_directory", {
  url: text("url").primaryKey(),
  name: text("name"),
  description: text("description"),
  pubkey: text("pubkey"),
  supportedNips: integer("supported_nips").array(),
  software: text("software"),
  version: text("version"),
  countryCode: text("country_code"),
  isPaid: boolean("is_paid").default(false),
  requiresAuth: boolean("requires_auth").default(false),
  rttMs: integer("rtt_ms"),
  userCount: integer("user_count").default(0),
  lastSeenOnline: timestamp("last_seen_online"),
  lastChecked: timestamp("last_checked"),
  nip11Json: text("nip11_json"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
