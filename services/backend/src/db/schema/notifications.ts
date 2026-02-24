import { text, boolean, timestamp } from "drizzle-orm/pg-core";
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
