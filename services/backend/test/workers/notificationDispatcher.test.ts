/**
 * One dispatcher pass with a fake Expo sender: grouping by collapse key,
 * TTL expiry, dead-token pruning, badge counts, attempt accounting on
 * transient failures, the per-recipient dm send gate (defer + fold, never
 * drop), the wrap ids a dm push names, receipt-stage errors — and the
 * running dispatcher's dm kick and in-process exclusivity.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 * Redis is ioredis-mock; web-push is mocked in setup.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { notificationQueue, pushDevices } from "../../src/db/schema/notifications.js";
import { pushService } from "../../src/services/pushService.js";
import { getRedis } from "../../src/lib/redis.js";
import {
  collapseGroup,
  dispatchOnce,
  DM_PUSH_MAX_EVENT_IDS,
  DM_SEND_GATE_SEC,
  housekeeping,
  HOUSEKEEPING_KEY,
  pollReceiptsOnce,
  QUEUE_TTL_MS,
  RECEIPT_DELAY_MS,
  requestDispatchSoon,
  startNotificationDispatcher,
  TICKETS_KEY,
} from "../../src/workers/notificationDispatcher.js";
import { enqueueNotification } from "../../src/services/notificationEnqueue.js";
import type { ExpoPushMessage, ExpoReceipt, ExpoSender, ExpoTicket } from "../../src/services/expoPushSender.js";

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});
beforeEach(async () => {
  // Tickets, dm send gates, wrap markers, remembered errors: the redis mock
  // is shared across tests in this file.
  const keys = await getRedis().keys("notif:*");
  if (keys.length > 0) await getRedis().del(...keys);
});
void server;

/** A running dispatcher a test started; always stopped so its timers
 *  never leak into the next test. */
let running: { stop: () => void } | null = null;
afterEach(() => {
  running?.stop();
  running = null;
});

/** Poll `cond` until true or throw after `timeoutMs` (real time). */
async function until(cond: () => Promise<boolean> | boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A queued dm row as the planner writes it, `ageMs` old. */
function dmRow(wrapId: string, ageMs = 0, pubkey = LUNA.pubkey) {
  return {
    pubkey,
    type: "dm",
    title: "soot",
    body: "new message",
    url: "soot://dm?segment=messages",
    collapseKey: `dm:${pubkey}`,
    data: JSON.stringify({ type: "dm", eventId: wrapId, relay: "wss://relay.test" }),
    createdAt: new Date(Date.now() - ageMs),
  };
}
const wrap = (n: number) => n.toString(16).padStart(64, "0");

const TOKEN = "ExponentPushToken[luna]";

function fakeSender(
  ticketFor: (m: ExpoPushMessage) => ExpoTicket = () => ({ status: "ok", id: randomUUID() }),
) {
  const sent: ExpoPushMessage[][] = [];
  const sender: ExpoSender = {
    send: vi.fn(async (messages) => {
      sent.push(messages);
      return messages.map(ticketFor);
    }),
    receipts: vi.fn(async () => ({})),
  };
  return { sender, sent };
}

async function seed(over: Partial<typeof notificationQueue.$inferInsert> & { pubkey?: string } = {}) {
  const id = randomUUID();
  await db.insert(notificationQueue).values({
    id,
    pubkey: LUNA.pubkey,
    type: "reply",
    title: "reply from alice",
    body: "nice",
    url: "soot://note/x",
    collapseKey: `activity:${LUNA.pubkey}`,
    data: null,
    createdAt: new Date(),
    ...over,
  });
  return id;
}

const rowsFor = (pubkey: string) =>
  db.select().from(notificationQueue).where(eq(notificationQueue.pubkey, pubkey));

async function device(pubkey = LUNA.pubkey, token = TOKEN, lastSeenAt?: Date) {
  await pushService.registerDevice({ pubkey, provider: "expo", token, platform: "ios" });
  if (lastSeenAt) await db.update(pushDevices).set({ lastSeenAt }).where(eq(pushDevices.token, token));
}

describe("collapseGroup (pure)", () => {
  const row = (type: string, title: string) =>
    ({ type, title, body: "b", url: "u" }) as unknown as typeof notificationQueue.$inferSelect;
  it("single rows pass through; multiples fold to a count; dms never grow a count", () => {
    expect(collapseGroup([row("reply", "a")])).toMatchObject({ title: "a", body: "b" });
    expect(collapseGroup([row("reply", "a"), row("reply", "b")])).toMatchObject({ title: "b", body: "2 new replies" });
    expect(collapseGroup([row("reply", "a"), row("zap", "b")]).body).toBe("2 new notifications");
    expect(collapseGroup([row("dm", "soot"), row("dm", "soot")]).body).toBe("b");
  });
});

describe("dispatchOnce", () => {
  it("sends one push per collapse group with a badge, then marks the rows sent", async () => {
    await device(LUNA.pubkey, TOKEN, new Date(Date.now() - 60_000));
    await seed({ title: "reply from alice" });
    await seed({ type: "zap", title: "21 sats from bob" });
    await seed({ pubkey: MARCUS.pubkey, collapseKey: `activity:${MARCUS.pubkey}` }); // no device → marked sent silently
    const { sender, sent } = fakeSender();

    const stats = await dispatchOnce({ sender });
    expect(stats.sent).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({
      to: TOKEN,
      title: "21 sats from bob",
      body: "2 new notifications",
      badge: 2,
      channelId: "activity",
      priority: "high",
      data: { type: "zap", url: "soot://note/x" },
    });
    expect((await rowsFor(LUNA.pubkey)).every((r) => r.sent)).toBe(true);
    expect((await rowsFor(MARCUS.pubkey)).every((r) => r.sent)).toBe(true);
    expect(await getRedis().llen(TICKETS_KEY)).toBe(1);
  });

  it("expires stale rows unsent and gives up after MAX_ATTEMPTS", async () => {
    await device();
    await seed({ createdAt: new Date(Date.now() - QUEUE_TTL_MS - 1000) });
    await seed({ attempts: 3 });
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.expired).toBe(2);
    expect(sent).toHaveLength(0);
    // Retired but never delivered: sent = true (never retry), sent_at NULL
    // (never counted by the badge).
    expect((await rowsFor(LUNA.pubkey)).every((r) => r.sent && r.sentAt === null)).toBe(true);
  });

  it("the badge counts pending and delivered rows, never retired-undelivered ones", async () => {
    await device(LUNA.pubkey, TOKEN, new Date(Date.now() - 3600_000));
    // A row retired without delivery (sent = true, sent_at NULL — e.g. expired
    // before dispatch) plus a real reply.
    await seed({
      type: "dm",
      title: "soot",
      body: "new message",
      collapseKey: `dm:${LUNA.pubkey}`,
      data: JSON.stringify({ type: "dm", eventId: "d".repeat(64), relay: "wss://r" }),
      createdAt: new Date(Date.now() - 5000),
      sent: true,
      sentAt: null,
    });
    await seed({ type: "reply" });

    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.sent).toBe(1);
    expect(sent).toHaveLength(1);
    // Without the sent_at gate this would be 2: the dm row is newer than the
    // device's last_seen_at but was never delivered.
    expect(sent[0][0].badge).toBe(1);
  });

  it("runs housekeeping at most once per hour", async () => {
    await getRedis().del(HOUSEKEEPING_KEY);
    await device();
    const old = await seed({ createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    await db.update(pushDevices).set({ lastSeenAt: new Date(Date.now() - 100 * 24 * 3600 * 1000) }).where(eq(pushDevices.token, TOKEN));

    await housekeeping();
    expect((await rowsFor(LUNA.pubkey)).map((r) => r.id)).not.toContain(old);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);

    // Second call inside the window is throttled: nothing is pruned.
    const old2 = await seed({ createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
    await housekeeping();
    expect((await rowsFor(LUNA.pubkey)).map((r) => r.id)).toContain(old2);
    await getRedis().del(HOUSEKEEPING_KEY);
  });

  it("a dm push wakes the iOS extension: mutableContent + category + DMPushData, body still content-free", async () => {
    await device();
    const wrapId = "e".repeat(64);
    await seed({
      type: "dm",
      title: "soot",
      body: "new message",
      url: "soot://dm?segment=messages",
      collapseKey: `dm:${LUNA.pubkey}`,
      data: JSON.stringify({ type: "dm", eventId: wrapId, relay: "wss://relay.test" }),
    });
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.sent).toBe(1);
    expect(sent[0][0]).toMatchObject({
      title: "soot",
      body: "new message",
      channelId: "dms",
      mutableContent: true,
      categoryId: "dm",
      data: { type: "dm", url: "soot://dm?segment=messages", eventId: wrapId, relay: "wss://relay.test" },
    });
    expect(sent[0][0].data!.eventIds).toEqual([wrapId]);
    // Non-dm pushes never carry the extension flags.
    await seed({ type: "reply" });
    const second = fakeSender();
    await dispatchOnce({ sender: second.sender });
    expect(second.sent[0][0].mutableContent).toBeUndefined();
    expect(second.sent[0][0].categoryId).toBeUndefined();
  });

  it("a report push carries { type: report, reportId } for the admin inbox and nothing else", async () => {
    await device();
    await seed({
      type: "report",
      title: "new report",
      body: "spam · a post",
      url: "soot://admin/reports/rep123",
      collapseKey: "report",
      data: JSON.stringify({ reportId: "rep123" }),
    });
    const { sender, sent } = fakeSender();
    await dispatchOnce({ sender });
    expect(sent[0][0].data).toEqual({ reportId: "rep123", type: "report", url: "soot://admin/reports/rep123" });
    expect(sent[0][0].mutableContent).toBeUndefined();
  });

  it("deletes a device on DeviceNotRegistered and still marks the row sent", async () => {
    await device();
    await seed();
    const { sender } = fakeSender(() => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }));
    const stats = await dispatchOnce({ sender });
    expect(stats.pruned).toBe(1);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
    expect((await rowsFor(LUNA.pubkey))[0].sent).toBe(true);
  });

  it("a transient failure bumps attempts and leaves the row for the next pass", async () => {
    await device();
    await seed();
    const sender: ExpoSender = { send: vi.fn(async () => { throw new Error("503"); }), receipts: vi.fn(async () => ({})) };
    await dispatchOnce({ sender });
    const [row] = await rowsFor(LUNA.pubkey);
    expect(row.sent).toBe(false);
    expect(row.attempts).toBe(1);
  });

  it("a partial delivery (one device ok, one ticket error) is retired, never re-sent to the device that got it", async () => {
    await device(LUNA.pubkey, "ExponentPushToken[luna-phone]");
    await device(LUNA.pubkey, "ExponentPushToken[luna-tablet]");
    await seed();
    const { sender, sent } = fakeSender((m) =>
      m.to === "ExponentPushToken[luna-tablet]"
        ? { status: "error", message: "boom", details: { error: "MessageRateExceeded" } }
        : { status: "ok", id: randomUUID() },
    );
    await dispatchOnce({ sender });
    expect(sent).toHaveLength(1);
    const [row] = await rowsFor(LUNA.pubkey);
    expect(row.sent).toBe(true);
    expect(row.sentAt).not.toBeNull();
    // A second pass sends nothing more.
    await dispatchOnce({ sender });
    expect(sent).toHaveLength(1);
  });

  it("a dm row whose wrap already expired (data.expiresAt) is retired unsent — no loud, empty 'new message'", async () => {
    await device();
    const data = JSON.stringify({ type: "dm", eventId: wrap(1), relay: "wss://relay.test", expiresAt: Date.now() - 1000 });
    await seed({ ...dmRow(wrap(1)), data });
    const live = JSON.stringify({ type: "dm", eventId: wrap(2), relay: "wss://relay.test", expiresAt: Date.now() + 60_000 });
    await seed({ ...dmRow(wrap(2)), data: live });
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.expired).toBe(1);
    expect(stats.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0][0].data!.eventIds).toEqual([wrap(2)]);
    const rows = await rowsFor(LUNA.pubkey);
    const retired = rows.find((r) => (r.data ?? "").includes(wrap(1)))!;
    expect(retired.sent).toBe(true);
    expect(retired.sentAt).toBeNull();
  });
});

describe("dm send gate (defer + fold, never drop)", () => {
  it("one push names every folded wrap, newest first, capped; eventId stays the newest", async () => {
    await device();
    for (let i = 1; i <= DM_PUSH_MAX_EVENT_IDS + 2; i++) await seed(dmRow(wrap(i), (20 - i) * 1000));
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.sent).toBe(DM_PUSH_MAX_EVENT_IDS + 2);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    const data = sent[0][0].data!;
    const newestFirst = Array.from({ length: DM_PUSH_MAX_EVENT_IDS }, (_, k) => wrap(DM_PUSH_MAX_EVENT_IDS + 2 - k));
    expect(data.eventIds).toEqual(newestFirst);
    expect(data.eventId).toBe(wrap(DM_PUSH_MAX_EVENT_IDS + 2));
    expect(sent[0][0]).toMatchObject({ title: "soot", body: "new message", mutableContent: true, categoryId: "dm" });
  });

  it("a dm right after a dm push waits behind the gate unsent, then folds into the next push", async () => {
    // Regression: a 120 s drop window at enqueue meant a receipt or typing
    // wrap that pushed first swallowed the real message behind it.
    await device();
    await seed(dmRow(wrap(1), 2000));
    const first = fakeSender();
    expect((await dispatchOnce({ sender: first.sender })).sent).toBe(1);
    const gateTtl = await getRedis().ttl(`notif:dmsent:${LUNA.pubkey}`);
    expect(gateTtl).toBeGreaterThan(0);
    expect(gateTtl).toBeLessThanOrEqual(DM_SEND_GATE_SEC);

    // Two more wraps inside the gate: deferred — not sent, not dropped, no
    // attempt burned.
    await seed(dmRow(wrap(2), 1000));
    await seed(dmRow(wrap(3), 0));
    const gated = fakeSender();
    const stats = await dispatchOnce({ sender: gated.sender });
    expect(stats).toMatchObject({ sent: 0, deferred: 2 });
    expect(gated.sent).toHaveLength(0);
    const pending = (await rowsFor(LUNA.pubkey)).filter((r) => !r.sent);
    expect(pending).toHaveLength(2);
    expect(pending.every((r) => r.attempts === 0)).toBe(true);

    // The gate lapses: ONE push for both, naming both.
    await getRedis().del(`notif:dmsent:${LUNA.pubkey}`);
    const next = fakeSender();
    expect((await dispatchOnce({ sender: next.sender })).sent).toBe(2);
    expect(next.sent).toHaveLength(1);
    expect(next.sent[0][0].data!.eventIds).toEqual([wrap(3), wrap(2)]);
    expect((await rowsFor(LUNA.pubkey)).every((r) => r.sent)).toBe(true);
  });

  it("the gate is per recipient and dm-only", async () => {
    await device(LUNA.pubkey, TOKEN);
    await device(MARCUS.pubkey, "ExponentPushToken[marcus]");
    await getRedis().set(`notif:dmsent:${LUNA.pubkey}`, "1", "EX", DM_SEND_GATE_SEC);
    await seed(dmRow(wrap(1)));
    await seed(dmRow(wrap(2), 0, MARCUS.pubkey));
    await seed({ type: "reply" }); // luna's activity push ignores her dm gate
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats).toMatchObject({ sent: 2, deferred: 1 });
    expect(sent.flat().map((m) => m.to).sort()).toEqual(["ExponentPushToken[marcus]", TOKEN].sort());
    expect(sent.flat().find((m) => m.to === TOKEN)!.data!.type).toBe("reply");
  });

  it("deferred rows still expire after QUEUE_TTL_MS", async () => {
    await device();
    await getRedis().set(`notif:dmsent:${LUNA.pubkey}`, "1", "EX", DM_SEND_GATE_SEC);
    await seed(dmRow(wrap(1), QUEUE_TTL_MS + 1000));
    const { sender, sent } = fakeSender();
    expect(await dispatchOnce({ sender })).toMatchObject({ expired: 1, deferred: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe("running dispatcher: dm kick", () => {
  it("a queued dm is pushed ~1 s after enqueue, not at the next tick", async () => {
    await device();
    const { sender, sent } = fakeSender();
    // Tick far away: only the kick can send within this test.
    running = startNotificationDispatcher({ sender, initialDelayMs: 60_000, intervalMs: 60_000 });
    const t0 = Date.now();
    expect(await enqueueNotification({ ...dmRow(wrap(1)), data: { type: "dm", eventId: wrap(1), relay: "wss://r" } })).toBe(true);
    await sleep(500);
    expect(sent).toHaveLength(0); // coalescing window: not instantly
    await until(() => sent.length === 1);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(sent[0][0].data!.eventIds).toEqual([wrap(1)]);
  });

  it("a dm deferred by the gate is re-requested when the gate lapses", async () => {
    await device();
    const { sender, sent } = fakeSender();
    running = startNotificationDispatcher({ sender, initialDelayMs: 60_000, intervalMs: 60_000 });
    // A push went out just now; the gate has ~1.6 s left.
    await getRedis().set(`notif:dmsent:${LUNA.pubkey}`, "1", "PX", 1600);
    const t0 = Date.now();
    await enqueueNotification({ ...dmRow(wrap(7)), data: { type: "dm", eventId: wrap(7), relay: "wss://r" } });
    // The kick (~1 s) finds the gate shut and leaves the row unsent…
    await until(async () => Date.now() - t0 > 1250);
    expect(sent).toHaveLength(0);
    expect((await rowsFor(LUNA.pubkey))[0].sent).toBe(false);
    // …and asks again when it lapses (~1.6 s), well before any tick.
    await until(() => sent.length === 1);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("never runs two passes at once in-process, even when the Redis lock is unavailable", async () => {
    await device();
    await seed({ type: "reply" });
    const redis = getRedis();
    const realSet = redis.set.bind(redis);
    // runWithWorkerLock runs UNGUARDED when Redis errors on the lock.
    const set = vi.spyOn(redis, "set").mockImplementation(((key: string, ...args: unknown[]) =>
      key.startsWith("worker:lock:")
        ? Promise.reject(new Error("redis down"))
        : (realSet as (...a: unknown[]) => Promise<unknown>)(key, ...args)) as typeof redis.set);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let releaseSend!: () => void;
    const sendHeld = new Promise<void>((r) => (releaseSend = r));
    let sends = 0;
    const sender: ExpoSender = {
      send: vi.fn(async (messages: ExpoPushMessage[]) => {
        sends++;
        await sendHeld;
        return messages.map(() => ({ status: "ok" as const, id: randomUUID() }));
      }),
      receipts: vi.fn(async () => ({})),
    };
    try {
      running = startNotificationDispatcher({ sender, initialDelayMs: 1, intervalMs: 60_000 });
      await until(() => sends === 1); // the tick's pass is mid-send
      requestDispatchSoon(0); // a kick lands meanwhile
      await sleep(300);
      expect(sends).toBe(1); // it waits instead of re-reading the unsent row
      releaseSend();
      await sleep(300);
      expect(sends).toBe(1); // and then finds nothing left to send
      expect((await rowsFor(LUNA.pubkey))[0].sent).toBe(true);
    } finally {
      set.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("pollReceiptsOnce", () => {
  it("asks for receipts only on old tickets and prunes dead tokens", async () => {
    await device();
    const now = Date.now();
    await getRedis().lpush(
      TICKETS_KEY,
      JSON.stringify({ id: "old", token: TOKEN, at: now - RECEIPT_DELAY_MS - 1 }),
      JSON.stringify({ id: "young", token: TOKEN, at: now }),
    );
    const receipts = vi.fn(async () => ({ old: { status: "error" as const, details: { error: "DeviceNotRegistered" } } }));
    const sender: ExpoSender = { send: vi.fn(async () => []), receipts };
    expect(await pollReceiptsOnce({ sender, now: () => now })).toBe(1);
    expect(receipts).toHaveBeenCalledWith(["old"]);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
    expect(await getRedis().llen(TICKETS_KEY)).toBe(1); // the young one waits
    // A ticket queued before entries carried their owner still finds it
    // (through the token, before the prune) — and the prune is remembered.
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({
      error: "DeviceNotRegistered",
      stage: "receipt",
      sentAt: now - RECEIPT_DELAY_MS - 1,
    });
  });

  it("an ok ticket's entry names the device owner", async () => {
    await device();
    await seed();
    const { sender } = fakeSender(() => ({ status: "ok", id: "tkt-1" }));
    await dispatchOnce({ sender });
    const [entry] = await getRedis().lrange(TICKETS_KEY, 0, -1);
    expect(JSON.parse(entry)).toMatchObject({ id: "tkt-1", token: TOKEN, pubkey: LUNA.pubkey });
  });

  it("puts tickets back when the receipts call fails", async () => {
    await device();
    const now = Date.now();
    await getRedis().lpush(
      TICKETS_KEY,
      JSON.stringify({ id: "old", token: TOKEN, at: now - RECEIPT_DELAY_MS - 1 }),
    );
    const sender: ExpoSender = {
      send: vi.fn(async () => []),
      receipts: vi.fn(async () => {
        throw new Error("503");
      }),
    };
    expect(await pollReceiptsOnce({ sender, now: () => now })).toBe(0);
    // The ticket survives for the next poll; the device is untouched.
    const restored = await getRedis().lrange(TICKETS_KEY, 0, -1);
    expect(restored.map((e) => JSON.parse(e).id)).toEqual(["old"]);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(1);
  });
});

describe("last delivery error (You → Notifications diagnostics)", () => {
  it("remembers a non-fatal ticket error per account and clears it on the next ok send", async () => {
    await device();
    await seed();
    const failing = fakeSender(() => ({ status: "error", message: "no APNs key", details: { error: "InvalidCredentials" } }));
    await dispatchOnce({ sender: failing.sender });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "InvalidCredentials", message: "no APNs key" });

    // The row is retried; a working sender clears the remembered error.
    const working = fakeSender();
    await dispatchOnce({ sender: working.sender });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toBeNull();
  });

  it("remembers a receipt-stage error (APNs refused after an ok ticket); a later ok ticket does not erase it", async () => {
    await device();
    const sentAt = Date.now() - RECEIPT_DELAY_MS - 1000;
    await getRedis().lpush(TICKETS_KEY, JSON.stringify({ id: "r1", token: TOKEN, pubkey: LUNA.pubkey, at: sentAt }));
    const receipts = vi.fn(async (): Promise<Record<string, ExpoReceipt>> => ({
      r1: { status: "error", message: "The Apple Push Notification service key is invalid", details: { error: "InvalidCredentials" } },
    }));
    await pollReceiptsOnce({ sender: { send: vi.fn(async () => []), receipts } });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({
      error: "InvalidCredentials",
      stage: "receipt",
      sentAt,
    });
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(1); // not a dead token

    // The next push gets an ok TICKET — that proves the send path, not
    // delivery: the receipt-stage error stays.
    await seed();
    const ok = fakeSender(() => ({ status: "ok", id: "r2" }));
    await dispatchOnce({ sender: ok.sender });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "InvalidCredentials" });

    // Its RECEIPT comes back ok: delivery works again, the error goes.
    const [entry] = await getRedis().lrange(TICKETS_KEY, 0, -1);
    const later = JSON.parse(entry).at + RECEIPT_DELAY_MS + 1;
    await pollReceiptsOnce({
      sender: { send: vi.fn(async () => []), receipts: vi.fn(async () => ({ r2: { status: "ok" as const } })) },
      now: () => later,
    });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toBeNull();
  });

  it("other receipt errors are remembered too; an ok receipt for an OLDER push never clears a newer error", async () => {
    await device();
    const now = Date.now();
    const old = now - RECEIPT_DELAY_MS - 60_000;
    const newer = now - RECEIPT_DELAY_MS - 1000;
    await getRedis().lpush(
      TICKETS_KEY,
      JSON.stringify({ id: "a", token: TOKEN, pubkey: LUNA.pubkey, at: old }),
      JSON.stringify({ id: "b", token: TOKEN, pubkey: LUNA.pubkey, at: newer }),
    );
    // Older push delivered, newer one refused (in either response order).
    const receipts = vi.fn(async (): Promise<Record<string, ExpoReceipt>> => ({
      b: { status: "error", message: "too big", details: { error: "MessageTooBig" } },
      a: { status: "ok" },
    }));
    await pollReceiptsOnce({ sender: { send: vi.fn(async () => []), receipts }, now: () => now });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "MessageTooBig", stage: "receipt", sentAt: newer });

    // A straggler ok receipt for a push sent before the refused one: stays.
    await getRedis().lpush(TICKETS_KEY, JSON.stringify({ id: "c", token: TOKEN, pubkey: LUNA.pubkey, at: old - 1 }));
    await pollReceiptsOnce({
      sender: { send: vi.fn(async () => []), receipts: vi.fn(async () => ({ c: { status: "ok" as const } })) },
      now: () => now,
    });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "MessageTooBig" });

    // A ticket-stage error about a later push survives an ok receipt for an
    // earlier one as well.
    await pushService.recordDeliveryError(LUNA.pubkey, "MessageRateExceeded", "slow down");
    await getRedis().lpush(TICKETS_KEY, JSON.stringify({ id: "d", token: TOKEN, pubkey: LUNA.pubkey, at: newer + 1 }));
    await pollReceiptsOnce({
      sender: { send: vi.fn(async () => []), receipts: vi.fn(async () => ({ d: { status: "ok" as const } })) },
      now: () => now,
    });
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "MessageRateExceeded", stage: "ticket" });
  });

  it("a dead token is pruned AND remembered, so the phone can re-register", async () => {
    await device();
    await seed();
    const dead = fakeSender(() => ({ status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }));
    await dispatchOnce({ sender: dead.sender });
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
    expect(await pushService.lastDeliveryError(LUNA.pubkey)).toMatchObject({ error: "DeviceNotRegistered" });
    await pushService.clearDeliveryError(LUNA.pubkey);
  });
});
