/**
 * One dispatcher pass with a fake Expo sender: grouping by collapse key,
 * TTL expiry, the DM suppress check at send time, dead-token pruning, badge
 * counts, and attempt accounting on transient failures.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 * Redis is ioredis-mock; web-push is mocked in setup.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
  housekeeping,
  HOUSEKEEPING_KEY,
  pollReceiptsOnce,
  QUEUE_TTL_MS,
  RECEIPT_DELAY_MS,
  TICKETS_KEY,
} from "../../src/workers/notificationDispatcher.js";
import type { ExpoPushMessage, ExpoSender, ExpoTicket } from "../../src/services/expoPushSender.js";

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});
beforeEach(async () => {
  await getRedis().del(TICKETS_KEY);
});
void server;

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
    // Non-dm pushes never carry the extension flags.
    await seed({ type: "reply" });
    const second = fakeSender();
    await dispatchOnce({ sender: second.sender });
    expect(second.sent[0][0].mutableContent).toBeUndefined();
    expect(second.sent[0][0].categoryId).toBeUndefined();
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
