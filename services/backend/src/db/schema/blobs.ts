import { text, bigint, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

/** Content-addressed blob storage metadata (Blossom BUD-01/02) */
export const blobs = appSchema.table("blobs", {
  sha256: text("sha256").primaryKey(),
  size: bigint("size", { mode: "number" }).notNull(),
  type: text("type"),
  uploaded: bigint("uploaded", { mode: "number" }).notNull(),
});

/** Tracks which pubkeys own which blobs (multi-owner for dedup) */
export const blobOwners = appSchema.table(
  "blob_owners",
  {
    sha256: text("sha256")
      .notNull()
      .references(() => blobs.sha256, { onDelete: "cascade" }),
    pubkey: text("pubkey").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sha256, t.pubkey] }),
  ],
);
