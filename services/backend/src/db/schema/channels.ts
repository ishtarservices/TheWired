import { text, integer, boolean, timestamp, unique, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

/**
 * A channel subfolder. `id` is stable and opaque (never shown to people; it is
 * unique per space only), `name` is what the sidebar shows. See
 * docs/CHANNEL_LAYOUT.md for the ordering and id rules.
 */
export const spaceChannelCategories = appSchema.table("space_channel_categories", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  id: text("id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.id] }),
]);

export const spaceChannels = appSchema.table("space_channels", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // chat | notes | media | articles | music | voice | video
  label: text("label").notNull(),
  /** A `space_channel_categories.id` in the same space, or null (uncategorized). */
  categoryId: text("category_id"),
  /** Space-wide canonical order (uncategorized first, then categories in order). */
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  adminOnly: boolean("admin_only").notNull().default(false),
  slowModeSeconds: integer("slow_mode_seconds").notNull().default(0),
  temporary: boolean("temporary").notNull().default(false),
  feedMode: text("feed_mode").notNull().default("all"),
  /** Overrides are a copy of the category's and follow its edits. */
  permissionsSynced: boolean("permissions_synced").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  unique("uq_space_channel_type_label").on(table.spaceId, table.type, table.label),
]);
