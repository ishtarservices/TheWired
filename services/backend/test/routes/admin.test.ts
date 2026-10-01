/**
 * Admin review of reports (ADMIN_PUBKEYS, NIP-98) — the contract soot's
 * in-app inbox is built against:
 *   GET  /admin/reports?status=&cursor=   → { reports, nextCursor }
 *   GET  /admin/reports/:id               → { report, target: { event?, profile?, priorReports } }
 *   POST /admin/reports/:id/resolve       → { report }  (resolution echoes the action)
 * plus the actions' effects (tombstone + delete, deleteMusic, suspension,
 * API hiding), sibling closing, the audit trail, and both reversals.
 *
 * Harness TRUNCATEs app.* between tests; relay.* rows are cleaned here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, DECKARD, SAGE } from "../helpers/testUsers.js";
import {
  deleteRelayEventsByPubkey,
  insertMusicEvent,
  insertRelayEvent,
  resetRelayModeration,
} from "../helpers/relayEvents.js";
import { db } from "../../src/db/connection.js";
import { reports } from "../../src/db/schema/reports.js";
import { cachedProfiles } from "../../src/db/schema/profiles.js";
import { moderationAuditLog } from "../../src/db/schema/moderation.js";
import { config } from "../../src/config.js";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { reportService } from "../../src/services/reportService.js";
import { suspensionService } from "../../src/services/suspensionService.js";
import type { ReportInput } from "../../src/lib/reports/reportInput.js";

let server: FastifyInstance;
const mutable = config as unknown as { adminPubkeys: string[]; relayUrl: string };
const saved = { admins: [...config.adminPubkeys], relayUrl: config.relayUrl };

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await deleteRelayEventsByPubkey([MARCUS.pubkey, SAGE.pubkey]);
  await resetRelayModeration();
  await closeTestServer();
});
beforeEach(async () => {
  mutable.adminPubkeys = [DECKARD.pubkey];
  // restoreEvent re-publishes to the relay; point it at nothing in tests.
  mutable.relayUrl = "ws://127.0.0.1:9";
  await resetRelayModeration();
  await deleteRelayEventsByPubkey([MARCUS.pubkey, SAGE.pubkey]);
  suspensionService.invalidate();
});
afterEach(() => {
  mutable.adminPubkeys = saved.admins;
  mutable.relayUrl = saved.relayUrl;
  vi.restoreAllMocks();
});

const asAdmin = { "x-auth-pubkey": DECKARD.pubkey };

function note(content: string, secretKey: Uint8Array = MARCUS.secretKey, createdAt = Math.floor(Date.now() / 1000)) {
  return finalizeEvent({ kind: 1, created_at: createdAt, tags: [], content }, secretKey);
}

function input(over: Partial<ReportInput>): ReportInput {
  return {
    source: "nostr",
    reporterPubkey: LUNA.pubkey,
    reporterIpHash: null,
    targetType: "event",
    targetEventId: null,
    targetCoordinate: null,
    targetPubkey: MARCUS.pubkey,
    targetKind: 1,
    targetContext: null,
    category: "spam",
    note: null,
    reportEventId: null,
    ...over,
  };
}

async function file(over: Partial<ReportInput>) {
  const { report, notified } = await reportService.file(input(over));
  await notified;
  return report;
}

function resolve(id: string, action: string, note?: string) {
  return server.inject({
    method: "POST",
    url: `/admin/reports/${id}/resolve`,
    headers: asAdmin,
    payload: note ? { action, note } : { action },
  });
}

async function relayRow(id: string) {
  return ((await db.execute(sql`SELECT id FROM relay.events WHERE id = ${id}`)) as unknown as unknown[])[0];
}

describe("admin guard", () => {
  it("401 anonymous, 403 for a non-admin, 200 for an ADMIN_PUBKEYS account", async () => {
    expect((await server.inject({ method: "GET", url: "/admin/reports" })).statusCode).toBe(401);
    const notAdmin = await server.inject({ method: "GET", url: "/admin/reports", headers: { "x-auth-pubkey": LUNA.pubkey } });
    expect(notAdmin.statusCode).toBe(403);
    expect(notAdmin.json().code).toBe("FORBIDDEN");
    expect((await server.inject({ method: "GET", url: "/admin/reports", headers: asAdmin })).statusCode).toBe(200);
  });
});

describe("GET /admin/reports", () => {
  it("lists newest first per status, keyset-paginated", async () => {
    const ids: string[] = [];
    for (const reporter of [LUNA.pubkey, SAGE.pubkey, DECKARD.pubkey]) {
      ids.push((await file({ reporterPubkey: reporter, targetType: "user", targetKind: null })).id);
    }
    const page1 = await server.inject({ method: "GET", url: "/admin/reports?status=open&limit=2", headers: asAdmin });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json().data;
    expect(body1.reports.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);
    expect(typeof body1.nextCursor).toBe("string");

    const page2 = await server.inject({
      method: "GET",
      url: `/admin/reports?status=open&limit=2&cursor=${body1.nextCursor}`,
      headers: asAdmin,
    });
    const body2 = page2.json().data;
    expect(body2.reports.map((r: { id: string }) => r.id)).toEqual([ids[0]]);
    expect(body2.nextCursor).toBeNull();

    const actioned = await server.inject({ method: "GET", url: "/admin/reports?status=actioned", headers: asAdmin });
    expect(actioned.json().data.reports).toEqual([]);
    expect((await server.inject({ method: "GET", url: "/admin/reports?status=nope", headers: asAdmin })).statusCode).toBe(400);
    expect((await server.inject({ method: "GET", url: "/admin/reports?cursor=%25%25", headers: asAdmin })).statusCode).toBe(400);
  });

  it("serialises the contract shape: optional fields omitted, never null", async () => {
    await file({ targetType: "user", targetKind: null, note: null });
    const [r] = (await server.inject({ method: "GET", url: "/admin/reports", headers: asAdmin })).json().data.reports;
    expect(Object.values(r)).not.toContain(null);
    expect(r).not.toHaveProperty("note");
    expect(r).not.toHaveProperty("resolution");
    expect(r).toMatchObject({ source: "nostr", targetType: "user", category: "spam", status: "open" });
    expect(Date.parse(r.createdAt)).not.toBeNaN();
  });
});

describe("GET /admin/reports/:id", () => {
  it("returns the reported event, the profile and the prior report count", async () => {
    const ev = note("buy my coin");
    await insertRelayEvent(ev);
    await db.insert(cachedProfiles).values({ pubkey: MARCUS.pubkey, name: "marcus", fetchedAt: Date.now() });
    await file({ reporterPubkey: SAGE.pubkey, targetType: "user", targetKind: null });
    const r = await file({ targetEventId: ev.id });

    const res = await server.inject({ method: "GET", url: `/admin/reports/${r.id}`, headers: asAdmin });
    expect(res.statusCode).toBe(200);
    const { report, target } = res.json().data;
    expect(report.id).toBe(r.id);
    expect(target.event).toMatchObject({ id: ev.id, content: "buy my coin", pubkey: MARCUS.pubkey });
    expect(target.profile).toEqual({ pubkey: MARCUS.pubkey, name: "marcus" });
    expect(target.priorReports).toBe(1);
    expect(target.distinctReporters).toBe(1);
    expect(target.suspended).toBe(false);

    expect((await server.inject({ method: "GET", url: "/admin/reports/missing", headers: asAdmin })).statusCode).toBe(404);
    expect((await server.inject({ method: "GET", url: "/admin/reports/bad%20id", headers: asAdmin })).statusCode).toBe(400);
  });

  it("never serves a DM target's event (the server cannot and must not open it)", async () => {
    const wrapId = "a1".repeat(32);
    const r = await file({ targetType: "dm", targetEventId: wrapId, targetKind: 1059 });
    const { target } = (await server.inject({ method: "GET", url: `/admin/reports/${r.id}`, headers: asAdmin })).json().data;
    expect(target.event).toBeUndefined();
  });
});

describe("POST /admin/reports/:id/resolve", () => {
  it("dismiss closes the report; a dismissed report takes no further action", async () => {
    const r = await file({ targetType: "user", targetKind: null });
    const res = await resolve(r.id, "dismiss", "not spam");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.report).toMatchObject({ status: "dismissed", resolution: "dismiss", resolutionNote: "not spam" });
    const again = await resolve(r.id, "suspend_pubkey");
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("REPORT_DISMISSED");
  });

  it("remove_event tombstones + deletes the event, closes sibling reports, audits — then suspend_pubkey still works", async () => {
    const ev = note("abuse");
    await insertRelayEvent(ev);
    const r = await file({ targetEventId: ev.id });
    const sibling = await file({ reporterPubkey: SAGE.pubkey, targetEventId: ev.id, category: "harassment" });
    const unrelated = await file({ reporterPubkey: SAGE.pubkey, targetType: "user", targetKind: null });
    const deleteDocument = getMeilisearchClient().index("events").deleteDocument as Mock;
    deleteDocument.mockClear();

    const res = await resolve(r.id, "remove_event");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.report).toMatchObject({ status: "actioned", resolution: "remove_event" });
    expect(res.json().data.closedSiblings).toBe(1);

    expect(await relayRow(ev.id)).toBeUndefined();
    const [tomb] = (await db.execute(
      sql`SELECT event, removed_by, report_id, restored_at FROM relay.tombstones WHERE event_id = ${ev.id}`,
    )) as unknown as Array<{ event: { content: string }; removed_by: string; report_id: string; restored_at: Date | null }>;
    expect(tomb).toMatchObject({ removed_by: DECKARD.pubkey, report_id: r.id, restored_at: null });
    expect(tomb.event.content).toBe("abuse");
    expect(deleteDocument).toHaveBeenCalledWith(ev.id);

    const [sib] = await db.select().from(reports).where(eq(reports.id, sibling.id));
    expect(sib).toMatchObject({ status: "actioned", resolution: "remove_event" });
    const [other] = await db.select().from(reports).where(eq(reports.id, unrelated.id));
    expect(other.status).toBe("open");

    // Remove, then suspend: allowed on an actioned report.
    const suspend = await resolve(r.id, "suspend_pubkey");
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().data.report.resolution).toBe("suspend_pubkey");
    const [susp] = (await db.execute(
      sql`SELECT suspended_by, lifted_at FROM relay.suspended_pubkeys WHERE pubkey = ${MARCUS.pubkey}`,
    )) as unknown as Array<{ suspended_by: string; lifted_at: Date | null }>;
    expect(susp).toEqual({ suspended_by: DECKARD.pubkey, lifted_at: null });
    // The unrelated user report against the same account closes with it.
    const [otherAfter] = await db.select().from(reports).where(eq(reports.id, unrelated.id));
    expect(otherAfter).toMatchObject({ status: "actioned", resolution: "suspend_pubkey" });

    // An actioned report cannot be dismissed.
    expect((await resolve(r.id, "dismiss")).json().code).toBe("REPORT_ACTIONED");

    const audit = await db.select().from(moderationAuditLog);
    expect(audit.map((a) => a.action).sort()).toEqual(["report_remove_event", "report_suspend_pubkey"]);
    expect(audit.every((a) => a.spaceId === null && a.actorPubkey === DECKARD.pubkey)).toBe(true);
    expect(JSON.parse(audit[0].details!)).toHaveProperty("reportId", r.id);
  });

  it("remove_music goes through deleteMusic and tombstones every stored version", async () => {
    const slug = "admin-test-song";
    const id = await insertMusicEvent({ kind: 31683, pubkey: MARCUS.pubkey, slug });
    const coordinate = `31683:${MARCUS.pubkey}:${slug}`;
    const r = await file({ targetType: "track", targetEventId: id, targetCoordinate: coordinate, targetKind: 31683, category: "copyright" });

    const res = await resolve(r.id, "remove_music");
    expect(res.statusCode).toBe(200);
    expect(await relayRow(id)).toBeUndefined();
    const tombs = (await db.execute(sql`SELECT kind FROM relay.tombstones WHERE event_id = ${id}`)) as unknown as unknown[];
    expect(tombs).toHaveLength(1);
  });

  it("remove_event on a track is routed to the music path", async () => {
    const slug = "admin-test-routed";
    const id = await insertMusicEvent({ kind: 31683, pubkey: MARCUS.pubkey, slug });
    const r = await file({ targetType: "track", targetEventId: id, targetKind: 31683 });
    const res = await resolve(r.id, "remove_event");
    expect(res.statusCode).toBe(200);
    const [audit] = await db.select().from(moderationAuditLog);
    expect(audit.action).toBe("report_remove_music");
  });

  it("refuses actions the target cannot take", async () => {
    const user = await file({ targetType: "user", targetKind: null });
    expect((await resolve(user.id, "remove_event")).json().code).toBe("TARGET_NOT_REMOVABLE");
    const gone = await file({ targetEventId: "b2".repeat(32), reporterPubkey: SAGE.pubkey });
    expect((await resolve(gone.id, "remove_event")).statusCode).toBe(404);
    const ev = note("not music");
    await insertRelayEvent(ev);
    const notMusic = await file({ targetEventId: ev.id, reporterPubkey: DECKARD.pubkey });
    expect((await resolve(notMusic.id, "remove_music")).json().code).toBe("NOT_MUSIC");
    expect((await resolve(notMusic.id, "ban_forever")).statusCode).toBe(400);
    expect((await resolve("nope", "dismiss")).statusCode).toBe(404);
  });

  it("escalate records the report as actioned and audits it, removing nothing", async () => {
    const ev = note("illegal");
    await insertRelayEvent(ev);
    const r = await file({ targetEventId: ev.id, category: "illegal" });
    const res = await resolve(r.id, "escalate", "sent to NCMEC");
    expect(res.json().data.report).toMatchObject({ status: "actioned", resolution: "escalate" });
    expect(await relayRow(ev.id)).toBeDefined();
    const [audit] = await db.select().from(moderationAuditLog);
    expect(audit.action).toBe("report_escalate");
  });
});

describe("suspension hides the account from API responses, reversibly", () => {
  it("profiles and people search drop a suspended account; lifting restores them", async () => {
    await db.insert(cachedProfiles).values([
      { pubkey: MARCUS.pubkey, name: "marcus", fetchedAt: Date.now() },
      { pubkey: SAGE.pubkey, name: "sage", fetchedAt: Date.now() },
    ]);
    const r = await file({ targetType: "user", targetKind: null });
    expect((await resolve(r.id, "suspend_pubkey")).statusCode).toBe(200);

    expect((await server.inject({ method: "GET", url: `/profiles/${MARCUS.pubkey}` })).statusCode).toBe(404);
    const batch = await server.inject({
      method: "POST",
      url: "/profiles/batch",
      payload: { pubkeys: [MARCUS.pubkey, SAGE.pubkey] },
    });
    expect(batch.json().data.map((p: { pubkey: string }) => p.pubkey)).toEqual([SAGE.pubkey]);

    const search = getMeilisearchClient().index("profiles").search as Mock;
    search.mockResolvedValueOnce({ hits: [{ pubkey: MARCUS.pubkey }, { pubkey: SAGE.pubkey }], estimatedTotalHits: 2 });
    const people = await server.inject({ method: "GET", url: "/search/people?q=a" });
    expect(people.json().data.people.map((p: { pubkey: string }) => p.pubkey)).toEqual([SAGE.pubkey]);
    expect(people.json().data.total).toBe(1);

    // Lift (reversal) — visible again, and the row stays as the record.
    const lift = await server.inject({ method: "POST", url: `/admin/suspensions/${MARCUS.pubkey}/lift`, headers: asAdmin });
    expect(lift.statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: `/profiles/${MARCUS.pubkey}` })).statusCode).toBe(200);
    const [row] = (await db.execute(
      sql`SELECT lifted_by FROM relay.suspended_pubkeys WHERE pubkey = ${MARCUS.pubkey}`,
    )) as unknown as Array<{ lifted_by: string }>;
    expect(row.lifted_by).toBe(DECKARD.pubkey);
    const again = await server.inject({ method: "POST", url: `/admin/suspensions/${MARCUS.pubkey}/lift`, headers: asAdmin });
    expect(again.statusCode).toBe(404);
  });
});

describe("restoring a removed event", () => {
  async function restoredBy(id: string) {
    const [tomb] = (await db.execute(
      sql`SELECT restored_by FROM relay.tombstones WHERE event_id = ${id}`,
    )) as unknown as Array<{ restored_by: string | null }>;
    return tomb.restored_by;
  }

  it("keeps the removal in force when the relay does not take the event", async () => {
    const ev = note("relay is down");
    await insertRelayEvent(ev);
    const r = await file({ targetEventId: ev.id });
    await resolve(r.id, "remove_event");
    // config.relayUrl points at a closed port in this file.
    const res = await server.inject({ method: "POST", url: `/admin/tombstones/${ev.id}/restore`, headers: asAdmin });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("RELAY_REFUSED");
    expect(await restoredBy(ev.id)).toBeNull();
  });

  it("clears the tombstone once the relay accepts the kept copy", async () => {
    const ev = note("wrongly removed");
    await insertRelayEvent(ev);
    const r = await file({ targetEventId: ev.id });
    await resolve(r.id, "remove_event");

    // A stub relay that accepts whatever it is sent.
    const { WebSocketServer } = await import("ws");
    const relay = new WebSocketServer({ port: 0 });
    const received: unknown[] = [];
    relay.on("connection", (socket) =>
      socket.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        received.push(msg[1]);
        socket.send(JSON.stringify(["OK", msg[1].id, true, ""]));
      }),
    );
    await new Promise((r) => relay.once("listening", r));
    mutable.relayUrl = `ws://127.0.0.1:${(relay.address() as { port: number }).port}`;
    try {
      const res = await server.inject({ method: "POST", url: `/admin/tombstones/${ev.id}/restore`, headers: asAdmin });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ restored: true });
      expect(received).toEqual([expect.objectContaining({ id: ev.id, content: "wrongly removed" })]);
      expect(await restoredBy(ev.id)).toBe(DECKARD.pubkey);
      const twice = await server.inject({ method: "POST", url: `/admin/tombstones/${ev.id}/restore`, headers: asAdmin });
      expect(twice.statusCode).toBe(404);
    } finally {
      await new Promise((r) => relay.close(r));
    }
  });
});
