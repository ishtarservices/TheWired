import { db } from "../db/connection.js";
import {
  pushDevices,
  pushSubscriptions,
  type PushPlatform,
  type PushProvider,
} from "../db/schema/notifications.js";
import { eq, and, lt } from "drizzle-orm";
import { nanoid } from "../lib/id.js";
import { getRedis } from "../lib/redis.js";

/** How long a client-declared "don't push me for this event" lives. The
 *  dispatcher checks it at send time, so it only has to outlive the
 *  ingest → dispatch gap (≤ ~35 s) with margin. */
export const SUPPRESS_TTL_SEC = 3600;
export const SUPPRESS_MAX_IDS = 20;

/** More devices than anyone plausibly owns — the cap only bounds junk-token
 *  registration (Expo throttles senders that push to dead tokens). */
export const MAX_DEVICES_PER_PUBKEY = 20;

export function suppressKey(pubkey: string): string {
  return `notif:suppress:${pubkey}`;
}

export interface RegisterDeviceParams {
  pubkey: string;
  provider: PushProvider;
  token: string;
  platform: PushPlatform;
  appVersion?: string;
  locale?: string;
}

export const pushService = {
  // ── Web Push (desktop) ──
  async subscribe(pubkey: string, endpoint: string, keys: { p256dh: string; auth: string }) {
    await db.insert(pushSubscriptions).values({
      id: nanoid(),
      pubkey,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    });
  },

  async unsubscribe(pubkey: string, endpoint: string) {
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.pubkey, pubkey), eq(pushSubscriptions.endpoint, endpoint)));
  },

  // ── Mobile devices ──

  /** Upsert on token: a re-register from another account REBINDS the device
   *  (a shared phone that switched users without a clean logout must not keep
   *  pushing the previous user's notifications). Doubles as the heartbeat.
   *  Returns null when the pubkey is at the device cap and the token is new
   *  (soft cap — the count and insert don't race-proof each other). */
  async registerDevice(params: RegisterDeviceParams): Promise<{ id: string } | null> {
    const existing = await db
      .select({ token: pushDevices.token })
      .from(pushDevices)
      .where(eq(pushDevices.pubkey, params.pubkey));
    if (
      existing.length >= MAX_DEVICES_PER_PUBKEY &&
      !existing.some((d) => d.token === params.token)
    ) {
      return null;
    }
    const id = nanoid();
    const now = new Date();
    const rows = await db
      .insert(pushDevices)
      .values({
        id,
        pubkey: params.pubkey,
        provider: params.provider,
        token: params.token,
        platform: params.platform,
        appVersion: params.appVersion ?? null,
        locale: params.locale ?? null,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: pushDevices.token,
        set: {
          pubkey: params.pubkey,
          provider: params.provider,
          platform: params.platform,
          appVersion: params.appVersion ?? null,
          locale: params.locale ?? null,
          lastSeenAt: now,
        },
      })
      .returning({ id: pushDevices.id });
    return { id: rows[0]?.id ?? id };
  },

  /** Only the owning pubkey may remove a token. Returns whether a row went. */
  async unregisterDevice(pubkey: string, token: string): Promise<boolean> {
    const rows = await db
      .delete(pushDevices)
      .where(and(eq(pushDevices.token, token), eq(pushDevices.pubkey, pubkey)))
      .returning({ id: pushDevices.id });
    return rows.length > 0;
  },

  async devicesFor(pubkey: string) {
    return db.select().from(pushDevices).where(eq(pushDevices.pubkey, pubkey));
  },

  /** Provider said the token is dead (DeviceNotRegistered / 410). */
  async deleteToken(token: string): Promise<void> {
    await db.delete(pushDevices).where(eq(pushDevices.token, token));
  },

  /** Housekeeping: devices not seen for `days`. */
  async pruneStaleDevices(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await db
      .delete(pushDevices)
      .where(lt(pushDevices.lastSeenAt, cutoff))
      .returning({ id: pushDevices.id });
    return rows.length;
  },

  // ── Client-declared suppression (the DM self-wrap) ──

  /** The client publishes a self-addressed gift wrap for every DM it sends;
   *  the ingester cannot tell it from an inbound one. The sender's app calls
   *  this with the self-wrap id; the dispatcher drops matching dm rows. Keyed
   *  by the caller's own pubkey — nobody can suppress someone else's. */
  async suppressEvents(pubkey: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const redis = getRedis();
    const key = suppressKey(pubkey);
    await redis.sadd(key, ...eventIds);
    await redis.expire(key, SUPPRESS_TTL_SEC);
  },

  async isSuppressed(pubkey: string, eventId: string): Promise<boolean> {
    const redis = getRedis();
    return (await redis.sismember(suppressKey(pubkey), eventId)) === 1;
  },
};
