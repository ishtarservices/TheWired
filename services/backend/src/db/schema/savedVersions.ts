import { text, bigint, boolean, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

/**
 * A fan's saved version of a music track (31683) or project (33123), keyed by
 * addressable id. `has_update` flips on when the ingester sees a strictly newer
 * event than the saved one; `latest_*` record that event so the client can
 * surface and acknowledge a version it hasn't received from a relay yet.
 * (Table name predates track support.)
 */
export const savedAlbumVersions = appSchema.table("saved_album_versions", {
  pubkey: text("pubkey").notNull(),
  addressableId: text("addressable_id").notNull(),
  savedEventId: text("saved_event_id").notNull(),
  savedCreatedAt: bigint("saved_created_at", { mode: "number" }).notNull(),
  hasUpdate: boolean("has_update").default(false),
  latestEventId: text("latest_event_id"),
  latestCreatedAt: bigint("latest_created_at", { mode: "number" }),
  savedAt: timestamp("saved_at").defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.pubkey, table.addressableId] }),
  addrIdx: index("saved_album_versions_addr_idx").on(table.addressableId),
}));
