import { text, bigint, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const savedAlbumVersions = appSchema.table("saved_album_versions", {
  pubkey: text("pubkey").notNull(),
  addressableId: text("addressable_id").notNull(),
  savedEventId: text("saved_event_id").notNull(),
  savedCreatedAt: bigint("saved_created_at", { mode: "number" }).notNull(),
  hasUpdate: boolean("has_update").default(false),
  savedAt: timestamp("saved_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.pubkey, table.addressableId] }),
}));
