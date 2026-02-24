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
  memberCount: integer("member_count").notNull().default(0),
  activeMembers24h: integer("active_members_24h").notNull().default(0),
  messagesLast24h: integer("messages_last_24h").notNull().default(0),
  featured: boolean("featured").notNull().default(false),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const spaceTags = appSchema.table("space_tags", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
});
