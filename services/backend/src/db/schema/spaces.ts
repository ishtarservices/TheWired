import { pgSchema, text, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

export const spaces = appSchema.table("spaces", {
  id: text("id").primaryKey(),
  hostRelay: text("host_relay").notNull(),
  name: text("name").notNull(),
  picture: text("picture"),
  about: text("about"),
  category: text("category"),
  language: text("language"),
  mode: text("mode").notNull().default("read-write"), // "read" | "read-write"
  // Governance/source-of-truth mode (Decentralized Spaces). Distinct from `mode`.
  // "platform" | "decentralized" | "nip29"
  spaceMode: text("space_mode").notNull().default("platform"),
  // Backend ingestion tier for this space's host relay: "none" | "discovery" | "full"
  ingestionTier: text("ingestion_tier").notNull().default("none"),
  // True when created in / imported from another app (not Wired-origin).
  externalOrigin: boolean("external_origin").notNull().default(false),
  memberCount: integer("member_count").notNull().default(0),
  // Member count mirrored from a NIP-29 relay's kind:39002 (relay-authoritative
  // spaces). Kept separate from member_count / app.space_members.
  mirroredMemberCount: integer("mirrored_member_count").notNull().default(0),
  activeMembers24h: integer("active_members_24h").notNull().default(0),
  messagesLast24h: integer("messages_last_24h").notNull().default(0),
  featured: boolean("featured").notNull().default(false),
  listed: boolean("listed").notNull().default(false),
  listedAt: timestamp("listed_at"),
  discoveryScore: integer("discovery_score").notNull().default(0),
  creatorPubkey: text("creator_pubkey"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const spaceTags = appSchema.table("space_tags", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});
