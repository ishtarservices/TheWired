import { text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const spaceChannels = appSchema.table("space_channels", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // chat | notes | media | articles | music
  label: text("label").notNull(),
  categoryId: text("category_id"),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  adminOnly: boolean("admin_only").notNull().default(false),
  slowModeSeconds: integer("slow_mode_seconds").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});
