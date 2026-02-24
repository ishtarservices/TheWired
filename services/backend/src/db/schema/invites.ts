import { text, integer, bigint, boolean, timestamp } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";
import { spaces } from "./spaces.js";

export const invites = appSchema.table("invites", {
  code: text("code").primaryKey(),
  spaceId: text("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull(),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: bigint("expires_at", { mode: "number" }),
  revoked: boolean("revoked").notNull().default(false),
  label: text("label"),
  autoAssignRole: text("auto_assign_role"),
  createdAt: timestamp("created_at").defaultNow(),
});
