import { text, bigint, jsonb } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const musicProposals = appSchema.table("music_proposals", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull(),
  addressableId: text("addressable_id").notNull(),
  targetAlbum: text("target_album").notNull(),
  proposerPubkey: text("proposer_pubkey").notNull(),
  ownerPubkey: text("owner_pubkey").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  changes: jsonb("changes").notNull(),
  status: text("status").notNull().default("open"),
  eventId: text("event_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
});
