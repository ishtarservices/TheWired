import { db } from "../db/connection.js";
import {
  notificationQueue,
  pushSubscriptions,
  pushDevices,
} from "../db/schema/notifications.js";
import { eq, and, lt, gt, or, isNotNull, sql, inArray } from "drizzle-orm";
import { config } from "../config.js";
import * as webPush from "web-push";
import { runWithWorkerLock, startLockedInterval } from "../lib/workerLock.js";
import { getRedis } from "../lib/redis.js";
import { pushService } from "../services/pushService.js";
import {
  createExpoSender,
  DEVICE_NOT_REGISTERED,
  type ExpoChannel,
  type ExpoPushMessage,
  type ExpoReceipt,
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

/** One ok ticket waiting for its receipt. `pubkey` (the device owner) is
 *  absent on entries queued by older builds. */
interface TicketEntry {
  id: string;
  token: string;
  pubkey?: string;
  /** unix ms the push was sent */
  at: number;
}

/** At most one dm push per recipient per this window. Rows that arrive
 *  inside it stay unsent and fold into the next push (one push naming every
 *  wrap) — they are deferred, never dropped. */
export const DM_SEND_GATE_SEC = 5;
const dmSentKey = (pubkey: string) => `notif:dmsent:${pubkey}`;
/** A dm enqueue asks for a pass this soon instead of waiting for the tick;
 *  the second lets a burst (a message and the receipt wraps around it)
 *  land in one pass. */
export const DM_DISPATCH_KICK_MS = 1000;
/** The wrap ids a dm push names for the iOS extension to fetch. */
export const DM_PUSH_MAX_EVENT_IDS = 10;
const DISPATCH_INTERVAL_MS = 30 * 1000;
const DISPATCHER_LOCK = "notificationDispatcher";
/** Run a gated group's re-request a beat after the gate's own expiry. */
const GATE_SLACK_MS = 50;
/** A kick that found another pass holding the lock retries this often, a
 *  few times: that pass may have read the queue before the kicking row. */
const KICK_LOCK_RETRY_MS = 1000;
const KICK_LOCK_RETRIES = 5;

type KickScheduler = (delayMs: number) => void;
let kickScheduler: KickScheduler | null = null;

/**
 * Ask this process's dispatcher for a pass in ~`delayMs` instead of waiting
 * for the 30 s tick. Requests coalesce onto one timer and never postpone an
 * earlier one; the pass runs under the tick's lock. A no-op when no
 * dispatcher runs in this process (tests, scripts) — the tick still drains
 * the queue.
 */
export function requestDispatchSoon(delayMs: number = DM_DISPATCH_KICK_MS): void {
  kickScheduler?.(delayMs);
}

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
    case "music_update":
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
  music_update: "music updates",
  report: "reports",
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
  pruned: number;
  /** dm rows left unsent behind a recipient's send gate. */
  deferred: number;
}

/** Up to DM_PUSH_MAX_EVENT_IDS distinct wrap ids of a dm group, newest
 *  first (rows arrive oldest first). */
function dmEventIds(rows: QueueRow[]): string[] {
  const ids: string[] = [];
  for (let i = rows.length - 1; i >= 0 && ids.length < DM_PUSH_MAX_EVENT_IDS; i--) {
    const id = parseData(rows[i])?.eventId;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** One dispatcher pass. Exported so tests drive it with a fake sender. */
export async function dispatchOnce(deps: DispatchDeps): Promise<DispatchStats> {
  const now = deps.now ?? Date.now;
  const stats: DispatchStats = { sent: 0, expired: 0, pruned: 0, deferred: 0 };

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

    // 3. A dm row whose wrap has expired (data.expiresAt, the wrap's own
    //    `expiration`) is retired unsent: the phone's extension could no
    //    longer decrypt it and would show the loud, empty server copy. (The
    //    relay sweeps expired wraps too.) Self-wrap suppression used to live
    //    here; the relay now flags those at ingest — contract §7.3.
    const stale = rows.filter((r) => {
      const at = parseData(r)?.expiresAt;
      return typeof at === "number" && at <= now();
    });
    if (stale.length > 0) {
      await markSent(stale.map((r) => r.id), false);
      stats.expired += stale.length;
    }
    const group = rows.filter((r) => !stale.includes(r));
    if (group.length === 0) continue;

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

    // 4'. DM send gate: one dm push per recipient per DM_SEND_GATE_SEC. A
    //     group that finds it shut stays unsent — it folds with whatever
    //     else arrives into one push when the gate lapses, and this process
    //     asks for that pass instead of waiting for the tick.
    const isDmGroup = group[0].collapseKey === `dm:${pubkey}`;
    if (isDmGroup) {
      const redis = getRedis();
      const open = await redis.set(dmSentKey(pubkey), "1", "EX", DM_SEND_GATE_SEC, "NX");
      if (open !== "OK") {
        const left = await redis.pttl(dmSentKey(pubkey));
        requestDispatchSoon((left > 0 ? left : DM_SEND_GATE_SEC * 1000) + GATE_SLACK_MS);
        stats.deferred += ids.length;
        continue;
      }
    }

    let allSent = true;
    /** Some target took the push: a retry would deliver it to that device
     *  twice, so a partial failure is logged and the group retired. Only a
     *  group NO target took is retried. */
    let anyDelivered = false;

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
          anyDelivered = true;
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
      const dmIds = isDmGroup ? dmEventIds(group) : [];
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
        const isDm = folded.type === "dm";
        // DM data carries DMPushData (eventId + relay) so the iOS Notification
        // Service Extension can fetch + decrypt on device; mutableContent wakes
        // it (docs/DM_WIRE_CONTRACT.md §8). eventIds names every wrap the
        // push folds (newest first; eventId stays the newest for older
        // apps). A report push carries its reportId (soot's admin inbox
        // opens it; services/reportNotifier).
        const newestData =
          isDm || folded.type === "report" ? (parseData(group[group.length - 1]) ?? {}) : {};
        if (isDm && dmIds.length > 0) newestData.eventIds = dmIds;
        messages.push({
          to: device.token,
          title: folded.title,
          body: folded.body,
          data: { ...newestData, type: folded.type, url: folded.url ?? undefined },
          sound: "default",
          badge: Math.max(1, Number(count) || 0),
          priority: "high",
          ttl: PUSH_TTL_SEC,
          channelId: channelFor(folded.type),
          ...(isDm ? { mutableContent: true, categoryId: "dm" } : {}),
        });
      }
      try {
        const tickets = await deps.sender.send(messages);
        const redis = getRedis();
        let anyOk = false;
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const token = expoDevices[i].token;
          if (ticket.status === "ok") {
            anyOk = true;
            if (ticket.id) {
              const entry: TicketEntry = { id: ticket.id, token, pubkey, at: now() };
              await redis.lpush(TICKETS_KEY, JSON.stringify(entry));
            }
          } else if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
            await pushService.deleteToken(token);
            await pushService.recordDeliveryError(pubkey, DEVICE_NOT_REGISTERED, ticket.message);
            stats.pruned++;
          } else {
            // Remembered per account so You → Notifications can show it: an
            // InvalidCredentials ticket (no APNs key on the Expo project) is
            // otherwise visible only here, in the server log.
            console.error(`[notifications] expo ticket error for ${pubkey}: ${ticket.message}`);
            await pushService.recordDeliveryError(pubkey, ticket.details?.error ?? "ticket_error", ticket.message);
            allSent = false;
          }
        }
        // An ok ticket proves the send path, not delivery: a receipt-stage
        // error (APNs refused an earlier push) stays until an ok receipt.
        if (anyOk) {
          anyDelivered = true;
          await pushService.clearDeliveryError(pubkey, { stage: "ticket" });
        }
      } catch (err) {
        console.error("[notifications] expo send failed:", (err as Error).message);
        await pushService.recordDeliveryError(pubkey, "send_failed", (err as Error).message).catch(() => {});
        allSent = false;
      }
    }

    if (allSent) {
      await markSent(ids, true);
      stats.sent += ids.length;
    } else if (anyDelivered) {
      // One device or subscription refused, another took it: re-sending the
      // group would push the same "new message" twice to the one that
      // worked. The error is remembered per account (You → Notifications).
      console.warn(`[notifications] partial delivery for ${pubkey}: not retrying ${ids.length} row(s)`);
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

/** Ask Expo for receipts on tickets old enough to have them. A
 *  DeviceNotRegistered receipt kills the token; every receipt error is
 *  remembered for the device owner (You → Notifications) — the receipt is
 *  where APNs/FCM refusals (InvalidCredentials, MessageTooBig,
 *  MessageRateExceeded, …) surface, after the ticket already said ok.
 *  Exported for tests. */
export async function pollReceiptsOnce(deps: DispatchDeps): Promise<number> {
  const now = deps.now ?? Date.now;
  const redis = getRedis();
  // Atomic drain: a ticket LPUSHed by a concurrent dispatch tick between a
  // separate LRANGE and DEL would be deleted unread.
  const drained = await redis.multi().lrange(TICKETS_KEY, 0, -1).del(TICKETS_KEY).exec();
  const raw = (drained?.[0]?.[1] as string[] | undefined) ?? [];
  if (raw.length === 0) return 0;

  const ready: TicketEntry[] = [];
  const young: string[] = [];
  for (const entry of raw) {
    try {
      const t = JSON.parse(entry) as TicketEntry;
      if (now() - t.at >= RECEIPT_DELAY_MS) ready.push(t);
      else young.push(entry);
    } catch {
      // drop garbage
    }
  }
  if (young.length > 0) await redis.lpush(TICKETS_KEY, ...young);
  if (ready.length === 0) return 0;

  let receipts: Record<string, ExpoReceipt>;
  try {
    receipts = await deps.sender.receipts(ready.map((t) => t.id));
  } catch (err) {
    console.error("[notifications] expo receipts failed:", (err as Error).message);
    // Put them back — receipts stay available for a day.
    await redis.lpush(TICKETS_KEY, ...ready.map((t) => JSON.stringify(t)));
    return 0;
  }

  // Per owner, in send order: the newest push that reached the phone and
  // the newest one that did not. Same-pass ties go to ok, as an ok ticket
  // on any device clears a ticket error in dispatchOnce.
  let pruned = 0;
  const outcome = new Map<string, { okAt: number; failed?: { sentAt: number; error: string; message?: string } }>();
  const slot = (pubkey: string) => {
    let o = outcome.get(pubkey);
    if (!o) outcome.set(pubkey, (o = { okAt: 0 }));
    return o;
  };
  for (const t of [...ready].sort((a, b) => a.at - b.at)) {
    const r = receipts[t.id];
    if (!r) continue; // not ready, or Expo no longer has it
    // Entries from older builds name only the token: resolve it before a
    // prune deletes the device row.
    const owner = t.pubkey ?? (await pushService.ownerOfToken(t.token));
    if (r.status === "error") {
      const error = r.details?.error ?? "receipt_error";
      if (error === DEVICE_NOT_REGISTERED) {
        await pushService.deleteToken(t.token);
        pruned++;
      } else {
        console.error(`[notifications] expo receipt error for ${owner ?? "unknown owner"}: ${error} ${r.message ?? ""}`);
      }
      if (owner) slot(owner).failed = { sentAt: t.at, error, message: r.message };
    } else if (owner) {
      slot(owner).okAt = t.at;
    }
  }
  for (const [owner, o] of outcome) {
    if (o.failed && o.failed.sentAt > o.okAt) {
      await pushService.recordDeliveryError(owner, o.failed.error, o.failed.message, { sentAt: o.failed.sentAt });
    } else if (o.okAt > 0) {
      await pushService.clearDeliveryErrorSentBy(owner, o.okAt);
    }
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

/** Dispatch queued push notifications. `opts` exists for tests. */
export function startNotificationDispatcher(
  opts: { sender?: ExpoSender; intervalMs?: number; initialDelayMs?: number } = {},
): { stop: () => void } {
  const sender = opts.sender ?? createExpoSender();
  let stopped = false;

  // One pass at a time in this process. The Redis lock already keeps the
  // tick and a kick apart (the second acquisition fails), but
  // runWithWorkerLock runs UNGUARDED when Redis is unreachable — two
  // overlapping passes would claim the same rows and push twice.
  let passChain: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = passChain.then(fn, fn);
    passChain = run.catch(() => {});
    return run;
  };
  const pass = async () => {
    const stats = await dispatchOnce({ sender });
    if (stats.sent || stats.expired || stats.pruned) {
      console.log(
        `[notifications] sent=${stats.sent} expired=${stats.expired} pruned=${stats.pruned}`,
      );
    }
  };

  // Run every 30 seconds, first run 5s after boot. Locked because the pending
  // query and the `sent = true` mark are separate statements: two replicas
  // ticking together would both claim the same rows and push twice.
  const job = startLockedInterval({
    name: DISPATCHER_LOCK,
    intervalMs: opts.intervalMs ?? DISPATCH_INTERVAL_MS,
    initialDelayMs: opts.initialDelayMs ?? 5000,
    lockTtlMs: DISPATCH_INTERVAL_MS,
    task: async () => {
      await exclusive(pass);
      await housekeeping().catch(() => {});
    },
  });

  // Kicks (requestDispatchSoon): one timer, due at the earliest request.
  let kickTimer: ReturnType<typeof setTimeout> | null = null;
  let kickDueAt = Infinity;
  let lockMisses = 0;
  const scheduleKick: KickScheduler = (delayMs) => {
    if (stopped) return;
    const wait = Math.max(0, delayMs);
    const due = Date.now() + wait;
    if (kickTimer && kickDueAt <= due) return;
    if (kickTimer) clearTimeout(kickTimer);
    kickDueAt = due;
    kickTimer = setTimeout(() => {
      kickTimer = null;
      kickDueAt = Infinity;
      void runKick();
    }, wait);
  };
  const runKick = async () => {
    if (stopped) return;
    try {
      const ran = await runWithWorkerLock(DISPATCHER_LOCK, DISPATCH_INTERVAL_MS, () => exclusive(pass));
      if (ran) lockMisses = 0;
      // Another pass holds the lock (this replica's tick, or another
      // replica): it may have read the queue before the kicking row landed.
      else if (++lockMisses <= KICK_LOCK_RETRIES) scheduleKick(KICK_LOCK_RETRY_MS);
      else lockMisses = 0;
    } catch (err) {
      console.error("[notifications] dispatch kick failed:", (err as Error).message);
    }
  };
  kickScheduler = scheduleKick;

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
      stopped = true;
      if (kickScheduler === scheduleKick) kickScheduler = null;
      if (kickTimer) clearTimeout(kickTimer);
      job.stop();
      receipts.stop();
      console.log("[notifications] Stopped");
    },
  };
}
