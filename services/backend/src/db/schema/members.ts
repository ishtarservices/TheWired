import { text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

export const spaceMembers = appSchema.table("space_members", {
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  pubkey: text("pubkey").notNull(),
  joinedAt: timestamp("joined_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.pubkey] }),
]);

export const memberRoles = appSchema.table("member_roles", {
  spaceId: text("space_id").notNull(),
  pubkey: text("pubkey").notNull(),
  roleId: text("role_id").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.spaceId, t.pubkey, t.roleId] }),
]);
