import { text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const nip05Identities = appSchema.table("nip05_identities", {
  username: text("username").primaryKey(),
  pubkey: text("pubkey").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("uq_nip05_pubkey").on(t.pubkey),
]);
