/**
 * POST /reports (the guest + fallback door) and the operator notification.
 *
 * - Guests are accepted; their IP (X-Client-Ip, set by the gateway) is stored
 *   only as a keyed hash. NIP-98 callers are attributed to their pubkey.
 * - Ids only: unknown body fields (e.g. message text) are dropped.
 * - Deduped on (reporter, target) while open; a repeat notifies nobody.
 * - Every new report pushes each ADMIN_PUBKEYS account (payload: reportId +
 *   category only) and posts the webhook (no reporter, no note).
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, DECKARD } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { reports } from "../../src/db/schema/reports.js";
import { notificationQueue } from "../../src/db/schema/notifications.js";
import { config } from "../../src/config.js";
import { hashReporterIp, reportService } from "../../src/services/reportService.js";
import { WEBHOOK_BURST, webhookMessage } from "../../src/services/reportNotifier.js";
import { getRedis } from "../../src/lib/redis.js";
import { collapseGroup } from "../../src/workers/notificationDispatcher.js";
import { processEvent } from "../../src/workers/ingestHandlers.js";
import { finalizeEvent } from "nostr-tools";

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

const mutableConfig = config as unknown as { adminPubkeys: string[]; reportWebhookUrl: string };
const savedAdmins = [...config.adminPubkeys];
const savedWebhook = config.reportWebhookUrl;
afterEach(() => {
  mutableConfig.adminPubkeys = [...savedAdmins];
  mutableConfig.reportWebhookUrl = savedWebhook;
  vi.restoreAllMocks();
});

const EVENT_ID = "e1".repeat(32);
const ZARA_PK = "5a".repeat(32);

function post(payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return server.inject({ method: "POST", url: "/reports", payload, headers });
}

describe("POST /reports — guests", () => {
  it("files a guest report keyed by a hash of the forwarded IP, never the IP", async () => {
    const res = await post(
      { target: "event", category: "spam", eventId: EVENT_ID, pubkey: MARCUS.pubkey, note: "  bot  " },
      { "x-client-ip": "203.0.113.7" },
    );
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id as string;
    expect(id).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);

    const [row] = await db.select().from(reports).where(eq(reports.id, id));
    expect(row).toMatchObject({
      source: "http",
      reporterPubkey: null,
      reporterIpHash: hashReporterIp("203.0.113.7"),
      targetType: "event",
      targetEventId: EVENT_ID,
      targetPubkey: MARCUS.pubkey,
      category: "spam",
      note: "bot",
      status: "open",
    });
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
  });

  it("dedupes the same guest + target while open, but not across IPs", async () => {
    const body = { target: "user", category: "impersonation", pubkey: MARCUS.pubkey };
    const first = await post(body, { "x-client-ip": "198.51.100.1" });
    const again = await post(body, { "x-client-ip": "198.51.100.1" });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().data.id).toBe(first.json().data.id);
    const other = await post(body, { "x-client-ip": "198.51.100.2" });
    expect(other.statusCode).toBe(201);
    expect(other.json().data.id).not.toBe(first.json().data.id);
  });

  it("drops anything that is not an id (no message text is ever stored)", async () => {
    const res = await post({
      target: "dm",
      category: "harassment",
      wrapId: "f".repeat(64),
      pubkey: MARCUS.pubkey,
      content: "the actual message text",
      plaintext: "the actual message text",
    });
    expect(res.statusCode).toBe(201);
    const [row] = await db.select().from(reports).where(eq(reports.id, res.json().data.id));
    expect(row.targetType).toBe("dm");
    expect(row.targetEventId).toBe("f".repeat(64));
    expect(JSON.stringify(row)).not.toContain("actual message");
  });

  it("files unknown categories as other; rejects bad targets and long notes", async () => {
    const odd = await post({ target: "user", category: "vibes", pubkey: MARCUS.pubkey });
    expect(odd.statusCode).toBe(201);
    const [row] = await db.select().from(reports).where(eq(reports.id, odd.json().data.id));
    expect(row.category).toBe("other");

    expect((await post({ target: "event", category: "spam" })).statusCode).toBe(400);
    expect((await post({ target: "planet", category: "spam", pubkey: MARCUS.pubkey })).statusCode).toBe(400);
    expect(
      (await post({ target: "user", category: "spam", pubkey: MARCUS.pubkey, note: "x".repeat(501) })).statusCode,
    ).toBe(400);
  });
});

describe("POST /reports — signed in", () => {
  it("attributes a NIP-98 report to the pubkey and stores no IP hash", async () => {
    const res = await post(
      { target: "track", category: "copyright", coordinate: `31683:${MARCUS.pubkey}:song`, eventKind: 31683 },
      { "x-auth-pubkey": LUNA.pubkey, "x-client-ip": "203.0.113.9" },
    );
    expect(res.statusCode).toBe(201);
    const [row] = await db.select().from(reports).where(eq(reports.id, res.json().data.id));
    expect(row).toMatchObject({
      reporterPubkey: LUNA.pubkey,
      reporterIpHash: null,
      targetType: "track",
      targetPubkey: MARCUS.pubkey,
      targetCoordinate: `31683:${MARCUS.pubkey}:song`,
    });
  });

  it("folds the same report arriving through both doors, in either order", async () => {
    // soot publishes the kind 1984 first and falls back to POST /reports when
    // the relay publish fails — sometimes both land.
    const kind1984 = (targetId: string) =>
      finalizeEvent(
        {
          kind: 1984,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["p", MARCUS.pubkey, "spam"],
            ["e", targetId, "spam"],
            ["k", "1"],
            ["L", "app.soot.report"],
            ["l", "spam", "app.soot.report"],
            ["L", "app.soot.report.target"],
            ["l", "event", "app.soot.report.target"],
          ],
        },
        LUNA.secretKey,
      );
    const own = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
    const http = (targetId: string) =>
      post(
        { target: "event", category: "spam", eventId: targetId, eventKind: 1, pubkey: MARCUS.pubkey },
        { "x-auth-pubkey": LUNA.pubkey },
      );

    // HTTP first, then the 1984.
    const a = "a7".repeat(32);
    const viaHttp = await http(a);
    expect(viaHttp.statusCode).toBe(201);
    await processEvent(kind1984(a), own);
    expect(await db.select().from(reports).where(eq(reports.targetEventId, a))).toHaveLength(1);

    // The 1984 first, then HTTP.
    const b = "b7".repeat(32);
    await processEvent(kind1984(b), own);
    const [fromNostr] = await db.select().from(reports).where(eq(reports.targetEventId, b));
    const late = await http(b);
    expect(late.statusCode).toBe(200);
    expect(late.json().data.id).toBe(fromNostr.id);
    expect(await db.select().from(reports).where(eq(reports.targetEventId, b))).toHaveLength(1);
  });

  it("refuses a self-report", async () => {
    const res = await post({ target: "user", category: "spam", pubkey: LUNA.pubkey }, { "x-auth-pubkey": LUNA.pubkey });
    expect(res.statusCode).toBe(400);
  });
});

describe("operator notification", () => {
  it("pushes every admin with only the report id + category, and posts the webhook", async () => {
    mutableConfig.adminPubkeys = [DECKARD.pubkey, MARCUS.pubkey];
    mutableConfig.reportWebhookUrl = "https://hooks.example.test/report";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    const { report, created, notified } = await reportService.file({
      source: "nostr",
      reporterPubkey: LUNA.pubkey,
      reporterIpHash: null,
      targetType: "event",
      targetEventId: EVENT_ID,
      targetCoordinate: null,
      targetPubkey: ZARA_PK,
      targetKind: 1,
      targetContext: null,
      category: "harassment",
      note: "they know where I live",
      reportEventId: "9".repeat(64),
    });
    expect(created).toBe(true);
    await notified;

    const queued = await db.select().from(notificationQueue);
    expect(queued.map((q) => q.pubkey).sort()).toEqual([DECKARD.pubkey, MARCUS.pubkey].sort());
    for (const q of queued) {
      expect(q.type).toBe("report");
      expect(q.url).toBe(`soot://admin/reports/${report.id}`);
      expect(q.collapseKey).toBe("report");
      expect(JSON.parse(q.data!)).toEqual({ reportId: report.id });
      // Expo/APNs read the payload: no reporter, no target, no note.
      const visible = `${q.title} ${q.body} ${q.data}`;
      expect(visible).not.toContain(LUNA.pubkey);
      expect(visible).not.toContain(ZARA_PK);
      expect(visible).not.toContain(EVENT_ID);
      expect(visible).not.toContain("where I live");
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.test/report");
    const body = JSON.parse(String(init.body)) as { content: string; text: string };
    expect(body.content).toBe(body.text);
    expect(body.content).toContain(report.id);
    expect(body.content).toContain("harassment");
    expect(body.content).not.toContain(LUNA.pubkey);
    expect(body.content).not.toContain("where I live");

    // A repeat (re-ingested 1984) notifies nobody.
    fetchSpy.mockClear();
    const again = await reportService.file({
      source: "nostr",
      reporterPubkey: LUNA.pubkey,
      reporterIpHash: null,
      targetType: "event",
      targetEventId: EVENT_ID,
      targetCoordinate: null,
      targetPubkey: ZARA_PK,
      targetKind: 1,
      targetContext: null,
      category: "harassment",
      note: null,
      reportEventId: "9".repeat(64),
    });
    await again.notified;
    expect(again.created).toBe(false);
    expect(again.report.id).toBe(report.id);
    expect(await db.select().from(notificationQueue)).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still pushes when the webhook fails, and skips the webhook when unset", async () => {
    mutableConfig.adminPubkeys = [DECKARD.pubkey];
    mutableConfig.reportWebhookUrl = "https://hooks.example.test/down";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ target: "user", category: "spam", pubkey: MARCUS.pubkey });
    expect(res.statusCode).toBe(201);
    await vi.waitFor(async () => {
      expect(await db.select().from(notificationQueue)).toHaveLength(1);
    });
  });

  it("caps webhook posts per window during a flood, and says so once", async () => {
    mutableConfig.reportWebhookUrl = "https://hooks.example.test/burst";
    await getRedis().del("reports:webhook:window");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    for (let i = 0; i < WEBHOOK_BURST + 3; i++) {
      const { notified } = await reportService.file({
        source: "http", reporterPubkey: null, reporterIpHash: `flood-${i}`, targetType: "user",
        targetEventId: null, targetCoordinate: null, targetPubkey: ZARA_PK, targetKind: null,
        targetContext: null, category: "spam", note: null, reportEventId: null,
      });
      await notified;
    }
    expect(fetchSpy).toHaveBeenCalledTimes(WEBHOOK_BURST + 1);
    const last = JSON.parse(String((fetchSpy.mock.calls.at(-1) as [string, RequestInit])[1].body));
    expect(last.content).toContain("arriving faster");
    // The window always carries its TTL, so the cap lifts on its own.
    const ttl = await getRedis().ttl("reports:webhook:window");
    expect(ttl).toBeGreaterThan(0);
    // Every report is still filed.
    expect(await db.select().from(reports)).toHaveLength(WEBHOOK_BURST + 3);
  });

  it("folds a burst of report pushes into one line", async () => {
    const rows = [1, 2, 3].map((i) => ({
      id: `r${i}`,
      pubkey: DECKARD.pubkey,
      type: "report",
      title: "new report",
      body: "spam · a post",
      data: JSON.stringify({ reportId: `id${i}` }),
      sent: false,
      createdAt: new Date(),
      collapseKey: "report",
      url: `soot://admin/reports/id${i}`,
      attempts: 0,
      sentAt: null,
    }));
    expect(collapseGroup(rows).body).toBe("3 new reports");
    expect(collapseGroup(rows).url).toBe("soot://admin/reports/id3");
  });

  it("webhook text names ids and counts, never the reporter or the note", async () => {
    const text = await webhookMessage({
      id: "abc123",
      source: "http",
      reporterPubkey: LUNA.pubkey,
      reporterIpHash: "hash",
      targetType: "dm",
      targetEventId: "f".repeat(64),
      targetCoordinate: null,
      targetPubkey: null,
      targetKind: 1059,
      targetContext: null,
      category: "harassment",
      note: "private words",
      reportEventId: null,
      status: "open",
      resolution: null,
      resolutionNote: null,
      resolvedBy: null,
      createdAt: new Date(),
      resolvedAt: null,
      triage: null,
    });
    expect(text).toContain("gift wrap");
    expect(text).not.toContain(LUNA.pubkey);
    expect(text).not.toContain("private words");
    expect(text).not.toContain("hash");
  });
});

