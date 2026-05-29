import { text, bigint, timestamp } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const cachedProfiles = appSchema.table("cached_profiles", {
  pubkey: text("pubkey").primaryKey(),
  name: text("name"),
  displayName: text("display_name"),
  picture: text("picture"),
  about: text("about"),
  nip05: text("nip05"),
  banner: text("banner"),
  lud16: text("lud16"),
  website: text("website"),
  /** kind:0 event created_at — the version clock for this replaceable event. */
  createdAt: bigint("created_at", { mode: "number" }),
  /** Wall-clock ms when we last fetched/refreshed this row (TTL/staleness, NOT version). */
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
