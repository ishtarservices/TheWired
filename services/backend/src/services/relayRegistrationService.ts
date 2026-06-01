import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaceRelays } from "../db/schema/relays.js";
import { spaces } from "../db/schema/spaces.js";
import { config } from "../config.js";
import { checkRelayUrl } from "../lib/relayUrlGuard.js";

export interface RegisterResult {
  ok: boolean;
  status?: string;
  error?: string;
  code?: string;
}

/** When a relay becomes approved, ensure the space is at least 'discovery' tier
 *  so the multi-relay manager will actually dial it (default tier is 'none'). */
async function activateIngestion(spaceId: string): Promise<void> {
  await db
    .update(spaces)
    .set({ ingestionTier: "discovery" })
    .where(and(eq(spaces.id, spaceId), eq(spaces.ingestionTier, "none")));
}

/**
 * Manages the `app.space_relays` ingestion registry (Decentralized Spaces, M3):
 * the allowlist of relays the backend will dial. Enforces the SSRF guard,
 * per-space + global caps, and the configured approval mode.
 */
export const relayRegistrationService = {
  /** Register a relay for a space's ingestion. Validates + caps + applies mode. */
  async register(spaceId: string, relayUrlRaw: string, registeredBy: string): Promise<RegisterResult> {
    if (config.relayRegistrationMode === "closed") {
      return { ok: false, error: "Relay registration is disabled", code: "REGISTRATION_CLOSED" };
    }

    const check = checkRelayUrl(relayUrlRaw, !config.isProduction);
    if (!check.ok || !check.url) {
      return { ok: false, error: check.reason ?? "invalid relay URL", code: "INVALID_RELAY_URL" };
    }
    const relayUrl = check.url;

    // Per-space cap (count distinct relays already registered for this space).
    const [{ count: perSpace }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(spaceRelays)
      .where(eq(spaceRelays.spaceId, spaceId));
    if (perSpace >= config.maxRelaysPerSpace) {
      // Allow re-registering an existing pair (idempotent), else reject.
      const [existing] = await db
        .select()
        .from(spaceRelays)
        .where(and(eq(spaceRelays.spaceId, spaceId), eq(spaceRelays.relayUrl, relayUrl)))
        .limit(1);
      if (!existing) {
        return { ok: false, error: "Too many relays for this space", code: "RELAY_LIMIT" };
      }
    }

    // Global cap on distinct relay URLs (only enforced when adding a NEW url).
    const [{ count: distinctUrls }] = await db
      .select({ count: sql<number>`count(distinct ${spaceRelays.relayUrl})::int` })
      .from(spaceRelays);
    const [urlSeen] = await db
      .select()
      .from(spaceRelays)
      .where(eq(spaceRelays.relayUrl, relayUrl))
      .limit(1);
    if (!urlSeen && distinctUrls >= config.maxIngestRelays) {
      return { ok: false, error: "Relay capacity reached", code: "INGEST_CAPACITY" };
    }

    const status = config.relayRegistrationMode === "open" ? "approved" : "pending";
    const approvedAt = status === "approved" ? new Date() : null;

    await db
      .insert(spaceRelays)
      .values({ spaceId, relayUrl, status, registeredBy, approvedAt })
      .onConflictDoUpdate({
        target: [spaceRelays.relayUrl, spaceRelays.spaceId],
        // Re-registering refreshes who/when but does NOT silently re-approve a
        // previously rejected/disabled relay.
        set: { registeredBy },
      });

    if (status === "approved") await activateIngestion(spaceId);

    return { ok: true, status };
  },

  /** List a space's registered relays + health. */
  async list(spaceId: string) {
    return db.select().from(spaceRelays).where(eq(spaceRelays.spaceId, spaceId));
  },

  /** Remove a (space, relay) registration. */
  async remove(spaceId: string, relayUrl: string): Promise<void> {
    await db
      .delete(spaceRelays)
      .where(and(eq(spaceRelays.spaceId, spaceId), eq(spaceRelays.relayUrl, relayUrl)));
  },

  /** Admin review: approve / reject / disable a registration. */
  async review(spaceId: string, relayUrl: string, status: "approved" | "rejected" | "disabled"): Promise<void> {
    await db
      .update(spaceRelays)
      .set({ status, approvedAt: status === "approved" ? new Date() : null })
      .where(and(eq(spaceRelays.spaceId, spaceId), eq(spaceRelays.relayUrl, relayUrl)));
    if (status === "approved") await activateIngestion(spaceId);
  },

  /** Does the space exist + who created it (for authz)? */
  async spaceCreator(spaceId: string): Promise<string | null | undefined> {
    const [row] = await db
      .select({ creatorPubkey: spaces.creatorPubkey })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    return row ? row.creatorPubkey : undefined; // undefined = no such space
  },
};
