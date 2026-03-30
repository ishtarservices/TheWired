import { text, integer, timestamp, date, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const musicPlayDaily = appSchema.table("music_play_daily", {
  addressableId: text("addressable_id").notNull(),
  date: date("date").notNull(),
  playCount: integer("play_count").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.addressableId, t.date] }),
]);

export const musicPlayListeners = appSchema.table("music_play_listeners", {
  addressableId: text("addressable_id").notNull(),
  pubkey: text("pubkey").notNull(),
  firstPlayedAt: timestamp("first_played_at").defaultNow().notNull(),
  lastPlayedAt: timestamp("last_played_at").defaultNow().notNull(),
  playCount: integer("play_count").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.addressableId, t.pubkey] }),
]);
