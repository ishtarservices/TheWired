import { db } from "../db/connection.js";
import { notificationQueue, notificationPreferences } from "../db/schema/notifications.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getRedis } from "../lib/redis.js";
import { pushService } from "./pushService.js";
import type { NotificationType } from "../lib/notifications/planNotifications.js";

export interface EnqueueParams {
  pubkey: string;
  type: NotificationType | string;
  title: string;
  body: string;
  /** Deep link the tap opens. */
  url?: string;
  /** Rows sharing (pubkey, collapseKey) send as one push. */
  collapseKey?: string;
  data?: Record<string, unknown>;
}

/** One "new message" push per recipient per window — a burst of DMs is one
 *  lock-screen line, not ten. */
export const DM_RATE_WINDOW_SEC = 120;
/** A release is addressable: an edit republishes the same kind:pubkey:d.
 *  One push per watcher per address per day, so a tag fix never re-buzzes. */
export const RELEASE_DEDUPE_SEC = 86_400;
/** The wraps REQ looks back 2 days on every (re)connect (relayConnectionManager
 *  WRAP_LOOKBACK_SEC), so each wrap replays; one push per wrap id, ever. Must
 *  outlive the lookback — and the 1h suppress TTL, so a replayed self-wrap
 *  can't buzz its own sender. */
export const WRAP_SEEN_SEC = 3 * 86_400;

type Prefs = typeof notificationPreferences.$inferSelect;

/** Pure: does this user's preference row let this notification through?
 *  Missing row = everything on. Exported for tests. */
export function preferencesAllow(
  p: Prefs | undefined,
  type: string,
  data: Record<string, unknown> | undefined,
  nowMs = Date.now(),
): boolean {
  if (!p) return true;
  if (!p.enabled) return false;
  if (p.dndUntil != null && p.dndUntil > nowMs) return false;

  switch (type) {
    case "mention":
      if (!p.mentions) return false;
      break;
    case "reply":
      if (!p.replies) return false;
      break;
    case "reaction":
      if (!p.reactions) return false;
      break;
    case "zap":
      if (!p.zaps) return false;
      break;
    case "dm":
      if (!p.dms) return false;
      break;
    case "follow":
      if (!p.newFollowers) return false;
      break;
    case "friend_request":
      if (!p.friendRequests) return false;
      break;
    case "post":
    case "release":
      if (!p.releases) return false;
      break;
    case "chat":
      if (!p.chatMessages) return false;
      break;
    default:
      break;
  }

  const spaceId = typeof data?.spaceId === "string" ? data.spaceId : undefined;
  if (spaceId) {
    if ((p.mutedSpaces ?? []).includes(spaceId)) return false; // desktop's legacy mute
    const mode = (p.spaceModes ?? {})[spaceId];
    if (mode === "nothing") return false;
    // "mentions" (the default) and "all" both let a mention through; v1 only
    // produces mention-level chat intents, so "all" adds nothing yet.
  }
  return true;
}

/**
 * Enqueue a push notification for a user, gated by their server-side
 * preferences. Resolves true when a row was written.
 */
export async function enqueueNotification(params: EnqueueParams): Promise<boolean> {
  const { pubkey, type, title, body, url, collapseKey, data } = params;
  try {
    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.pubkey, pubkey))
      .limit(1);
    if (!preferencesAllow(rows[0], type, data)) return false;

    if (type === "dm") {
      // Content-free pushes are only worth sending to a phone; desktop has
      // the relay open. Checked before the wrap marker so a wrap first seen
      // while the user has no device can still push after they register one.
      const devices = await pushService.devicesFor(pubkey);
      if (devices.length === 0) return false;
      // The wraps REQ replays up to 2 days of wraps on every reconnect: a
      // wrap id pushes at most once, ever.
      const wrapId = typeof data?.eventId === "string" ? data.eventId : undefined;
      if (wrapId) {
        const fresh = await getRedis().set(`notif:wrap:${wrapId}`, "1", "EX", WRAP_SEEN_SEC, "NX");
        if (fresh !== "OK") return false;
      }
      // And one per window: the dispatcher collapses, but a burst spread over
      // minutes would otherwise buzz for each message.
      const ok = await getRedis().set(`notif:dm:${pubkey}`, "1", "EX", DM_RATE_WINDOW_SEC, "NX");
      if (ok !== "OK") return false;
    }

    if (type === "release" && typeof data?.address === "string") {
      const ok = await getRedis().set(`notif:release:${pubkey}:${data.address}`, "1", "EX", RELEASE_DEDUPE_SEC, "NX");
      if (ok !== "OK") return false;
    }

    await db.insert(notificationQueue).values({
      id: randomUUID(),
      pubkey,
      type,
      title,
      body,
      url: url ?? null,
      collapseKey: collapseKey ?? null,
      data: data ? JSON.stringify(data) : null,
    });
    return true;
  } catch (err) {
    console.error("[notificationEnqueue] Failed to enqueue:", err);
    return false;
  }
}
