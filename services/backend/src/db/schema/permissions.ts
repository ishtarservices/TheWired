import { text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const spaceRoles = appSchema.table("space_roles", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  color: text("color"),
  isDefault: boolean("is_default").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const rolePermissions = appSchema.table("role_permissions", {
  roleId: text("role_id").notNull().references(() => spaceRoles.id, { onDelete: "cascade" }),
  permission: text("permission").notNull(),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.permission] }),
]);

export const channelOverrides = appSchema.table("channel_overrides", {
  roleId: text("role_id").notNull().references(() => spaceRoles.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  permission: text("permission").notNull(),
  effect: text("effect").notNull(), // 'allow' | 'deny'
}, (t) => [
  primaryKey({ columns: [t.roleId, t.channelId, t.permission] }),
]);
