import { text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export const pushSubscriptions = appSchema.table("push_subscriptions", {
  id: text("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notificationQueue = appSchema.table("notification_queue", {
  id: text("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: text("data"),
  sent: boolean("sent").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notificationPreferences = appSchema.table("notification_preferences", {
  pubkey: text("pubkey").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  mentions: boolean("mentions").notNull().default(true),
  dms: boolean("dms").notNull().default(true),
  newFollowers: boolean("new_followers").notNull().default(true),
  chatMessages: boolean("chat_messages").notNull().default(true),
  mutedSpaces: jsonb("muted_spaces").default([]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
