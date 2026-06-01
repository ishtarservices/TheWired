import { text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { appSchema, spaces } from "./spaces.js";

/**
 * Per-(relay, space) ingestion registry (Decentralized Spaces, PACKAGES_DESIGN
 * §6 / M3). This is the allowlist of relays the backend will dial for
 * ingestion, with per-pair approval + health — distinct from `relayDirectory`
 * (a public browse catalog). The multi-relay ingestion manager groups its
 * desired connections by `relayUrl`.
 */
export const spaceRelays = appSchema.table(
  "space_relays",
  {
    relayUrl: text("relay_url").notNull(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // pending | approved | rejected | disabled
    status: text("status").notNull().default("pending"),
    registeredBy: text("registered_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    approvedAt: timestamp("approved_at"),
    lastEventAt: timestamp("last_event_at"),
    errorCount: integer("error_count").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [primaryKey({ columns: [t.relayUrl, t.spaceId] })],
);

/**
 * Per-user named relay tunnel routing record (Decentralized Spaces, M7). Maps a
 * Wired user to the Cloudflare tunnel + subdomain fronting their self-hosted
 * embedded relay. NO tunnel secret is stored here — the connector secret lives
 * on the user's device (OS keychain). One tunnel per user (PK on owner_pubkey),
 * used for idempotent re-provisioning.
 */
export const relayTunnels = appSchema.table("relay_tunnels", {
  ownerPubkey: text("owner_pubkey").primaryKey(),
  relayPubkey: text("relay_pubkey"),
  tunnelId: text("tunnel_id").notNull(),
  hostname: text("hostname").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
