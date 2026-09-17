import { db } from "../db/connection.js";
import {
  notificationQueue,
  pushSubscriptions,
  pushDevices,
} from "../db/schema/notifications.js";
import { eq, and, lt, gt, or, isNotNull, sql, inArray } from "drizzle-orm";
import { config } from "../config.js";
import * as webPush from "web-push";
import { startLockedInterval } from "../lib/workerLock.js";
import { getRedis } from "../lib/redis.js";
import { pushService } from "../services/pushService.js";
import {
  createExpoSender,
  DEVICE_NOT_REGISTERED,
  type ExpoChannel,
  type ExpoPushMessage,
  type ExpoSender,
} from "../services/expoPushSender.js";

/** A stale "new message" is worse than none — rows older than this are
 *  dropped unsent. Comfortably above the 30 s poll and any transient retry. */
export const QUEUE_TTL_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
export const BATCH_LIMIT = 200;
export const PUSH_TTL_SEC = 3600;
/** Ticket ids wait this long before receipts are asked for (Expo guidance). */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
export const TICKETS_KEY = "notif:expo:tickets";
export const HOUSEKEEPING_KEY = "notif:housekeeping";
const QUEUE_RETENTION_DAYS = 7;
const DEVICE_RETENTION_DAYS = 90;

let vapidConfigured = false;

function ensureVapidConfig() {
  if (vapidConfigured) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) return false;
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  vapidConfigured = true;
  return true;
}

type QueueRow = typeof notificationQueue.$inferSelect;

export function channelFor(type: string): ExpoChannel {
  switch (type) {
    case "dm":
      return "dms";
    case "chat":
      return "spaces";
    case "post":
    case "release":
      return "releases";
    case "reply":
    case "mention":
    case "reaction":
    case "zap":
      return "activity";
    default:
      return "default";
  }
}

const NOUN: Record<string, string> = {
  reply: "replies",
  mention: "mentions",
  reaction: "reactions",
  zap: "zaps",
  chat: "mentions",
  post: "posts",
  release: "releases",
};

/** Pure: fold a collapse group into one title/body. Exported for tests. */
export function collapseGroup(rows: QueueRow[]): { title: string; body: string; url: string | null; type: string } {
  const newest = rows[rows.length - 1];
  if (rows.length === 1 || newest.type === "dm") {
    return { title: newest.title, body: newest.body, url: newest.url, type: newest.type };
  }
  const types = new Set(rows.map((r) => r.type));
  const noun = types.size === 1 ? (NOUN[newest.type] ?? "notifications") : "notifications";
  return {
    title: newest.title,
    body: `${rows.length} new ${noun}`,
    url: newest.url,
    type: newest.type,
  };
}

function parseData(row: QueueRow): Record<string, unknown> | undefined {
  if (!row.data) return undefined;
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export interface DispatchDeps {
  sender: ExpoSender;
  now?: () => number;
}

interface DispatchStats {
  sent: number;
  expired: number;
  suppressed: number;
  pruned: number;
}

/** One dispatcher pass. Exported so tests drive it with a fake sender. */
export async function dispatchOnce(deps: DispatchDeps): Promise<DispatchStats> {
  const now = deps.now ?? Date.now;
  const stats: DispatchStats = { sent: 0, expired: 0, suppressed: 0, pruned: 0 };

  const pending = await db
    .select()
    .from(notificationQueue)
    .where(eq(notificationQueue.sent, false))
    .orderBy(notificationQueue.createdAt)
    .limit(BATCH_LIMIT);
  if (pending.length === 0) return stats;

  /** `delivered: false` retires a row nothing was sent for (expired,
   *  suppressed, nobody to tell): sent = true so it is never retried, but
   *  sent_at stays NULL so the badge query below doesn't count it. */
  const markSent = async (ids: string[], delivered: boolean) => {
    if (ids.length === 0) return;
    await db
      .update(notificationQueue)
      .set({ sent: true, sentAt: delivered ? new Date(now()) : null })
      .where(inArray(notificationQueue.id, ids));
  };

  // 1. Expire stale / exhausted rows unsent.
  const cutoff = now() - QUEUE_TTL_MS;
  const expired = pending.filter(
    (r) => (r.createdAt?.getTime() ?? 0) < cutoff || r.attempts >= MAX_ATTEMPTS,
  );
  await markSent(expired.map((r) => r.id), false);
  stats.expired = expired.length;
  const live = pending.filter((r) => !expired.includes(r));

  // 2. Group by (pubkey, collapse key).
  const groups = new Map<string, QueueRow[]>();
  for (const row of live) {
    const key = `${row.pubkey}|${row.collapseKey ?? row.id}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  const webPushReady = ensureVapidConfig();

  for (const rows of groups.values()) {
    const pubkey = rows[0].pubkey;

    // 3. Client-declared suppression (the DM self-wrap), checked at send time
    //    so the ingest-before-suppress race is closed.
    let group = rows;
    if (rows[0].type === "dm") {
      const kept: QueueRow[] = [];
      const dropped: string[] = [];
      for (const row of rows) {
        const eventId = parseData(row)?.eventId;
        if (typeof eventId === "string" && (await pushService.isSuppressed(pubkey, eventId))) {
          dropped.push(row.id);
        } else {
          kept.push(row);
        }
      }
      await markSent(dropped, false);
      stats.suppressed += dropped.length;
      if (kept.length === 0) continue;
      group = kept;
    }

    const ids = group.map((r) => r.id);
    const folded = collapseGroup(group);

    // 4. Targets.
    const [subs, devices] = await Promise.all([
      db.select().from(pushSubscriptions).where(eq(pushSubscriptions.pubkey, pubkey)),
      db.select().from(pushDevices).where(eq(pushDevices.pubkey, pubkey)),
    ]);
    if (subs.length === 0 && devices.length === 0) {
      await markSent(ids, false); // nobody to tell — never retry
      continue;
    }

    let allSent = true;

    // 4a. Web push (desktop) — unchanged path.
    if (subs.length > 0 && webPushReady) {
      const payload = JSON.stringify({
        title: folded.title,
        body: folded.body,
        data: { ...(parseData(group[group.length - 1]) ?? {}), url: folded.url ?? undefined },
        type: folded.type,
      });
      for (const sub of subs) {
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await db
              .delete(pushSubscriptions)
              .where(and(eq(pushSubscriptions.pubkey, sub.pubkey), eq(pushSubscriptions.endpoint, sub.endpoint)));
          } else {
            allSent = false;
          }
        }
      }
    }

    // 4b. Expo devices — badge = rows newer than the device's last foreground.
    const expoDevices = devices.filter((d) => d.provider === "expo");
    if (expoDevices.length > 0) {
      const messages: ExpoPushMessage[] = [];
      for (const device of expoDevices) {
        // Unseen = still pending, or actually delivered (sent_at set). Rows
        // retired undelivered — expired, suppressed self-wraps, nobody to
        // tell — must not inflate the badge.
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notificationQueue)
          .where(
            and(
              eq(notificationQueue.pubkey, pubkey),
              gt(notificationQueue.createdAt, device.lastSeenAt),
              or(eq(notificationQueue.sent, false), isNotNull(notificationQueue.sentAt)),
            ),
          );
        messages.push({
          to: device.token,
          title: folded.title,
          body: folded.body,
          data: { type: folded.type, url: folded.url ?? undefined },
          sound: "default",
          badge: Math.max(1, Number(count) || 0),
          priority: "high",
          ttl: PUSH_TTL_SEC,
          channelId: channelFor(folded.type),
        });
      }
      try {
        const tickets = await deps.sender.send(messages);
        const redis = getRedis();
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const token = expoDevices[i].token;
          if (ticket.status === "ok") {
            if (ticket.id) {
              await redis.lpush(TICKETS_KEY, JSON.stringify({ id: ticket.id, token, at: now() }));
            }
          } else if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
            await pushService.deleteToken(token);
            stats.pruned++;
          } else {
            console.error(`[notifications] expo ticket error for ${pubkey}: ${ticket.message}`);
            allSent = false;
          }
        }
      } catch (err) {
        console.error("[notifications] expo send failed:", (err as Error).message);
        allSent = false;
      }
    }

    if (allSent) {
      await markSent(ids, true);
      stats.sent += ids.length;
    } else {
      await db
        .update(notificationQueue)
        .set({ attempts: sql`${notificationQueue.attempts} + 1` })
        .where(inArray(notificationQueue.id, ids));
    }
  }

  return stats;
}

/** Ask Expo for receipts on tickets old enough to have them; a
 *  DeviceNotRegistered receipt kills the token. Exported for tests. */
export async function pollReceiptsOnce(deps: DispatchDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const redis = getRedis();
  // Atomic drain: a ticket LPUSHed by a concurrent dispatch tick between a
  // separate LRANGE and DEL would be deleted unread.
  const drained = await redis.multi().lrange(TICKETS_KEY, 0, -1).del(TICKETS_KEY).exec();
  const raw = (drained?.[0]?.[1] as string[] | undefined) ?? [];
  if (raw.length === 0) return 0;

  const ready: Array<{ id: string; token: string; at: number }> = [];
  const young: string[] = [];
  for (const entry of raw) {
    try {
      const t = JSON.parse(entry) as { id: string; token: string; at: number };
      if (now() - t.at >= RECEIPT_DELAY_MS) ready.push(t);
      else young.push(entry);
    } catch {
      // drop garbage
    }
  }
  if (young.length > 0) await redis.lpush(TICKETS_KEY, ...young);
  if (ready.length === 0) return 0;

  let pruned = 0;
  try {
    const receipts = await deps.sender.receipts(ready.map((t) => t.id));
    for (const t of ready) {
      const r = receipts[t.id];
      if (r?.status === "error" && r.details?.error === DEVICE_NOT_REGISTERED) {
        await pushService.deleteToken(t.token);
        pruned++;
      }
    }
  } catch (err) {
    console.error("[notifications] expo receipts failed:", (err as Error).message);
    // Put them back — receipts stay available for a day.
    await redis.lpush(TICKETS_KEY, ...ready.map((t) => JSON.stringify(t)));
  }
  return pruned;
}

/** At most one real pass per hour across all replicas (Redis NX). Exported
 *  for tests. */
export async function housekeeping(): Promise<void> {
  const ok = await getRedis().set(HOUSEKEEPING_KEY, "1", "EX", 3600, "NX");
  if (ok !== "OK") return;
  const queueCutoff = new Date(Date.now() - QUEUE_RETENTION_DAYS * 24 * 3600 * 1000);
  await db.delete(notificationQueue).where(lt(notificationQueue.createdAt, queueCutoff));
  await pushService.pruneStaleDevices(DEVICE_RETENTION_DAYS);
}

/** Dispatch queued push notifications. */
export function startNotificationDispatcher(): { stop: () => void } {
  const sender = createExpoSender();
  // Run every 30 seconds, first run 5s after boot. Locked because the pending
  // query and the `sent = true` mark are separate statements: two replicas
  // ticking together would both claim the same rows and push twice.
  const job = startLockedInterval({
    name: "notificationDispatcher",
    intervalMs: 30 * 1000,
    initialDelayMs: 5000,
    task: async () => {
      const stats = await dispatchOnce({ sender });
      if (stats.sent || stats.expired || stats.suppressed || stats.pruned) {
        console.log(
          `[notifications] sent=${stats.sent} expired=${stats.expired} suppressed=${stats.suppressed} pruned=${stats.pruned}`,
        );
      }
      await housekeeping().catch(() => {});
    },
  });
  const receipts = startLockedInterval({
    name: "expoReceiptPoller",
    intervalMs: 15 * 60 * 1000,
    initialDelayMs: 60 * 1000,
    task: async () => {
      const pruned = await pollReceiptsOnce({ sender });
      if (pruned) console.log(`[notifications] receipts pruned ${pruned} dead tokens`);
    },
  });

  return {
    stop: () => {
      job.stop();
      receipts.stop();
      console.log("[notifications] Stopped");
    },
  };
}
