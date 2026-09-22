import { db } from "../db/connection.js";
import {
  pushDevices,
  pushSubscriptions,
  type PushPlatform,
  type PushProvider,
} from "../db/schema/notifications.js";
import { eq, and, lt } from "drizzle-orm";
import { nanoid } from "../lib/id.js";

/** More devices than anyone plausibly owns — the cap only bounds junk-token
 *  registration (Expo throttles senders that push to dead tokens). */
export const MAX_DEVICES_PER_PUBKEY = 20;

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
};
