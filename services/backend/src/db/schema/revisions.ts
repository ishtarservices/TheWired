import { text, integer, bigint, jsonb, unique } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const musicRevisions = appSchema.table("music_revisions", {
  id: text("id").primaryKey(),
  addressableId: text("addressable_id").notNull(),
  kind: integer("kind").notNull(),
  pubkey: text("pubkey").notNull(),
  version: integer("version").notNull(),
  eventId: text("event_id").notNull(),
  eventJson: jsonb("event_json").notNull(),
  summary: text("summary"),
  diffJson: jsonb("diff_json"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => ({
  uniqueVersion: unique().on(table.addressableId, table.version),
}));
