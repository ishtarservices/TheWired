import { text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema } from "./spaces.js";

export type AccountClientKind = "desktop" | "mobile" | "web";

/**
 * Which of our apps an account has been seen on (activity report: desktop vs
 * mobile vs external Nostr clients). Written by the authContext hook from the
 * X-Wired-Client header, at most once per pubkey+client per 10 minutes.
 * `platform` is '' when the client did not say.
 */
export const accountClients = appSchema.table(
  "account_clients",
  {
    pubkey: text("pubkey").notNull(),
    client: text("client").$type<AccountClientKind>().notNull(),
    platform: text("platform").notNull().default(""),
    version: text("version").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pubkey, t.client, t.platform] })],
);
