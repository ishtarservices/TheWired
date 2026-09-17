/**
 * The server-side push gate: a user's notification_preferences row decides
 * whether an intent becomes a queue row. DM intents additionally need a
 * registered device and are rate-limited per recipient.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 * Redis is ioredis-mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { notificationQueue } from "../../src/db/schema/notifications.js";
import { enqueueNotification, preferencesAllow } from "../../src/services/notificationEnqueue.js";
import { pushService } from "../../src/services/pushService.js";
import { getRedis } from "../../src/lib/redis.js";

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

const putPrefs = (payload: Record<string, unknown>) =>
  server.inject({
    method: "PUT",
    url: "/notifications/preferences",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload,
  });

const queued = () => db.select().from(notificationQueue).where(eq(notificationQueue.pubkey, LUNA.pubkey));

const intent = (type: string, data?: Record<string, unknown>) => ({
  pubkey: LUNA.pubkey,
  type,
  title: "t",
  body: "b",
  url: "soot://activity",
  collapseKey: `activity:${LUNA.pubkey}`,
  data,
});

describe("preferencesAllow (pure)", () => {
  const base = {
    pubkey: LUNA.pubkey,
    enabled: true,
    mentions: true,
    dms: true,
    newFollowers: true,
    chatMessages: true,
    mutedSpaces: [] as string[],
    replies: true,
    reactions: true,
    zaps: true,
    releases: true,
    friendRequests: true,
    spaceModes: {} as Record<string, "all" | "mentions" | "nothing">,
    watchedPubkeys: [] as string[],
    dndUntil: null as number | null,
    createdAt: null,
    updatedAt: null,
  };

  it("missing row allows; enabled=false and active dnd block everything", () => {
    expect(preferencesAllow(undefined, "reply", undefined)).toBe(true);
    expect(preferencesAllow({ ...base, enabled: false }, "reply", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, dndUntil: Date.now() + 60_000 }, "dm", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, dndUntil: Date.now() - 60_000 }, "dm", undefined)).toBe(true);
  });

  it("each type has its switch", () => {
    expect(preferencesAllow({ ...base, replies: false }, "reply", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, reactions: false }, "reaction", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, zaps: false }, "zap", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, mentions: false }, "mention", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, releases: false }, "release", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, releases: false }, "post", undefined)).toBe(false);
    expect(preferencesAllow({ ...base, chatMessages: false }, "chat", { spaceId: "s1" })).toBe(false);
    expect(preferencesAllow(base, "chat", { spaceId: "s1" })).toBe(true);
  });

  it("space modes and the legacy mute list gate space-scoped intents", () => {
    expect(preferencesAllow({ ...base, spaceModes: { s1: "nothing" } }, "chat", { spaceId: "s1" })).toBe(false);
    expect(preferencesAllow({ ...base, spaceModes: { s1: "mentions" } }, "chat", { spaceId: "s1" })).toBe(true);
    expect(preferencesAllow({ ...base, mutedSpaces: ["s1"] }, "chat", { spaceId: "s1" })).toBe(false);
    expect(preferencesAllow({ ...base, spaceModes: { s1: "nothing" } }, "chat", { spaceId: "s2" })).toBe(true);
  });
});

describe("enqueueNotification", () => {
  it("writes a row with url and collapse key by default", async () => {
    expect(await enqueueNotification(intent("reply", { eventId: "x" }))).toBe(true);
    const rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "reply",
      url: "soot://activity",
      collapseKey: `activity:${LUNA.pubkey}`,
      sent: false,
      attempts: 0,
    });
    expect(JSON.parse(rows[0].data!)).toEqual({ eventId: "x" });
  });

  it("honours the stored preferences", async () => {
    await putPrefs({ zaps: false, spaceModes: { s1: "nothing" } });
    expect(await enqueueNotification(intent("zap"))).toBe(false);
    expect(await enqueueNotification(intent("chat", { spaceId: "s1" }))).toBe(false);
    expect(await enqueueNotification(intent("chat", { spaceId: "s2" }))).toBe(true);
    expect(await queued()).toHaveLength(1);
  });

  it("dm needs a device and is rate-limited per recipient", async () => {
    await getRedis().del(`notif:dm:${LUNA.pubkey}`);
    expect(await enqueueNotification(intent("dm", { eventId: "a" }))).toBe(false);
    await pushService.registerDevice({
      pubkey: LUNA.pubkey,
      provider: "expo",
      token: "ExponentPushToken[luna]",
      platform: "ios",
    });
    expect(await enqueueNotification(intent("dm", { eventId: "a" }))).toBe(true);
    expect(await enqueueNotification(intent("dm", { eventId: "b" }))).toBe(false); // inside the window
    expect(await queued()).toHaveLength(1);
    await getRedis().del(`notif:dm:${LUNA.pubkey}`);
  });
});
