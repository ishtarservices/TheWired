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
    expect((await rowsFor(LUNA.pubkey)).every((r) => r.sent)).toBe(true);
  });

  it("drops a dm the recipient suppressed (their own self-wrap) at send time", async () => {
    await device();
    const wrapId = "e".repeat(64);
    await seed({ type: "dm", title: "soot", body: "new message", collapseKey: `dm:${LUNA.pubkey}`, data: JSON.stringify({ eventId: wrapId }) });
    await pushService.suppressEvents(LUNA.pubkey, [wrapId]);
    const { sender, sent } = fakeSender();
    const stats = await dispatchOnce({ sender });
    expect(stats.suppressed).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await rowsFor(LUNA.pubkey))[0].sent).toBe(true);
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
});
