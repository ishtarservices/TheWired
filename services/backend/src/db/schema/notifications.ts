import { text, boolean, timestamp, jsonb, integer, bigint, index, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

/** Web Push (desktop) subscriptions — VAPID endpoint + keys. */
export const pushSubscriptions = appSchema.table("push_subscriptions", {
  id: text("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PushProvider = "expo" | "apns" | "fcm";
export type PushPlatform = "ios" | "android";

/** Mobile push devices. `token` is UNIQUE on purpose: a device belongs to
 *  whoever is signed in on it, and a re-register rebinds the pubkey. */
export const pushDevices = appSchema.table(
  "push_devices",
  {
    id: text("id").primaryKey(),
    pubkey: text("pubkey").notNull(),
    provider: text("provider").$type<PushProvider>().notNull(),
    token: text("token").notNull().unique(),
    platform: text("platform").$type<PushPlatform>().notNull(),
    appVersion: text("app_version"),
    locale: text("locale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_push_devices_pubkey").on(t.pubkey)],
);

export const notificationQueue = appSchema.table("notification_queue", {
  id: text("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: text("data"),
  sent: boolean("sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  /** Rows sharing (pubkey, collapse_key) send as one push. */
  collapseKey: text("collapse_key"),
  /** Deep link the tap opens (soot://…). */
  url: text("url"),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export type SpaceNotifMode = "all" | "mentions" | "nothing";

export const notificationPreferences = appSchema.table("notification_preferences", {
  pubkey: text("pubkey").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  mentions: boolean("mentions").notNull().default(true),
  dms: boolean("dms").notNull().default(true),
  newFollowers: boolean("new_followers").notNull().default(true),
  chatMessages: boolean("chat_messages").notNull().default(true),
  /** Desktop's legacy mute list — read as space_modes[id] = "nothing". */
  mutedSpaces: jsonb("muted_spaces").$type<string[]>().default([]),
  replies: boolean("replies").notNull().default(true),
  reactions: boolean("reactions").notNull().default(true),
  zaps: boolean("zaps").notNull().default(true),
  releases: boolean("releases").notNull().default(true),
  friendRequests: boolean("friend_requests").notNull().default(true),
  spaceModes: jsonb("space_modes").$type<Record<string, SpaceNotifMode>>().notNull().default({}),
  watchedPubkeys: jsonb("watched_pubkeys").$type<string[]>().notNull().default([]),
  /** unix ms; null = off. */
  dndUntil: bigint("dnd_until", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Inverted index of notification_preferences.watched_pubkeys. */
export const watchedBy = appSchema.table(
  "watched_by",
  {
    authorPubkey: text("author_pubkey").notNull(),
    watcherPubkey: text("watcher_pubkey").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.authorPubkey, t.watcherPubkey] }),
    index("idx_watched_by_watcher").on(t.watcherPubkey),
  ],
);
