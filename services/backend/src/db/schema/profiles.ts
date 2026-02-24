import { text, bigint, timestamp } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const cachedProfiles = appSchema.table("cached_profiles", {
  pubkey: text("pubkey").primaryKey(),
  name: text("name"),
  displayName: text("display_name"),
  picture: text("picture"),
  about: text("about"),
  nip05: text("nip05"),
  fetchedAt: bigint("fetched_at", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
