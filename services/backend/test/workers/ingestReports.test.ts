/**
 * The nostr door for reports, end to end through `processEvent`: a signed
 * kind 1984 in soot's layout from the platform relay becomes one app.reports
 * row (replays are no-ops); a foreign relay cannot file one. Plus the ingest
 * blocks that moderation and account deletion rely on.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi, type Mock } from "vitest";
import { eq, sql } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools";
import { LUNA, MARCUS, SAGE, JAYDEE, ZARA } from "../helpers/testUsers.js";
import { deleteRelayEventsByPubkey, insertRelayEvent, resetRelayModeration } from "../helpers/relayEvents.js";
import { db } from "../../src/db/connection.js";
import { reports, accountDeletions } from "../../src/db/schema/reports.js";
import { nip05Identities } from "../../src/db/schema/nip05.js";
import { notificationQueue } from "../../src/db/schema/notifications.js";
import { config } from "../../src/config.js";
import { reportService, FOREIGN_RESOLUTION, SYSTEM_ACTOR } from "../../src/services/reportService.js";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { authorBlocked, planIngest, processEvent, type IngestContext } from "../../src/workers/ingestHandlers.js";
import { accountDeletionService } from "../../src/services/accountDeletionService.js";
import { suspensionService } from "../../src/services/suspensionService.js";

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const ext: IngestContext = { relayUrl: "wss://ext", isOwnRelay: false, allowedSpaceIds: new Set(["s"]) };

/** soot's buildReportEvent output for an event target. */
function sootReport(targetId: string, category = "spam", nip56 = "spam") {
  return finalizeEvent(
    {
      kind: 1984,
      created_at: Math.floor(Date.now() / 1000),
      content: "seen it three times today",
      tags: [
        ["p", MARCUS.pubkey, nip56],
        ["e", targetId, nip56],
        ["k", "1"],
        ["L", "app.soot.report"],
        ["l", category, "app.soot.report"],
        ["L", "app.soot.report.target"],
        ["l", "event", "app.soot.report.target"],
        ["alt", `report: ${category}`],
      ],
    },
    LUNA.secretKey,
  );
}

beforeEach(async () => {
  await resetRelayModeration();
  suspensionService.invalidate();
  accountDeletionService.invalidate();
});
afterAll(async () => {
  await resetRelayModeration();
});

describe("kind 1984 ingest", () => {
  it("routes reports from the platform relay only", () => {
    const ev = sootReport("c".repeat(64));
    expect(planIngest(ev, own)).toEqual({ action: "report", indexSearch: false });
    expect(planIngest(ev, ext).action).toBeNull();
  });

  it("files one report per event, attributed to the signer, and replays are no-ops", async () => {
    // soot's reporter is an app user (her name is here); see "foreign reports"
    // below for what happens to a 1984 from an account that is not.
    await db.insert(nip05Identities).values({ username: "luna", pubkey: LUNA.pubkey });
    const ev = sootReport("c".repeat(64), "harassment", "other");
    await processEvent(ev, own);
    await processEvent(ev, own); // relay replay on reconnect
    const rows = await db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "nostr",
      reporterPubkey: LUNA.pubkey,
      targetType: "event",
      targetEventId: "c".repeat(64),
      targetPubkey: MARCUS.pubkey,
      category: "harassment",
      note: "seen it three times today",
      reportEventId: ev.id,
      status: "open",
      resolution: null,
    });
    // Other files leave MARCUS content in relay.events (never truncated), so
    // the target-side signals vary; the reporter-side one is what this seeds.
    const triage = rows[0].triage as { origin: string; signals: string[] };
    expect(triage.origin).toBe("local");
    expect(triage.signals).toContain("reporter_app_user");
  });

  it("ignores a forged signature and a foreign relay's copy", async () => {
    const ev = sootReport("c".repeat(64));
    await processEvent({ ...ev, content: "tampered" }, own);
    await processEvent(ev, ext);
    expect(await db.select().from(reports)).toHaveLength(0);
  });
});

/**
 * Reports by accounts that are not ours about content that is not here.
 * Clients publish a kind 1984 to every relay they are connected to, so a
 * public relay collects them; they are stored closed and notify nobody.
 */
describe("foreign reports", () => {
  const mutableConfig = config as unknown as { adminPubkeys: string[] };
  const savedAdmins = [...config.adminPubkeys];
  // JAYDEE is the outsider; ZARA is the outside target. Neither has an app
  // row, and neither has content on the relay unless a test adds some.
  const OUTSIDE_TARGET = ZARA.pubkey;
  let seq = 0;
  const unique = () => `d${(seq++).toString(16)}`.padEnd(64, "0");

  function outsideReport(targetId: string, over: { targetPubkey?: string; tags?: string[][] } = {}) {
    return finalizeEvent(
      {
        kind: 1984,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: over.tags ?? [
          ["p", over.targetPubkey ?? OUTSIDE_TARGET, "spam"],
          ["e", targetId, "spam"],
        ],
      },
      JAYDEE.secretKey,
    );
  }

  beforeEach(() => {
    mutableConfig.adminPubkeys = [SAGE.pubkey];
  });
  // relay.events is not truncated by the harness: content another file, or
  // the previous test, gave the outsiders must not shape this footprint.
  beforeEach(async () => {
    await deleteRelayEventsByPubkey([JAYDEE.pubkey, ZARA.pubkey]);
  });
  afterEach(async () => {
    await deleteRelayEventsByPubkey([JAYDEE.pubkey, ZARA.pubkey]);
  });
  afterAll(() => {
    mutableConfig.adminPubkeys = savedAdmins;
  });

  it("stores an outsider's report about outside content closed, without notifying anyone", async () => {
    const ev = outsideReport(unique());
    await processEvent(ev, own);
    const rows = await db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "nostr",
      reporterPubkey: JAYDEE.pubkey,
      targetPubkey: OUTSIDE_TARGET,
      reportEventId: ev.id,
      status: "dismissed",
      resolution: FOREIGN_RESOLUTION,
      resolvedBy: SYSTEM_ACTOR,
      triage: {
        origin: "foreign",
        signals: ["reporter_not_app_user", "target_not_app_user", "target_event_absent", "target_content_absent"],
      },
    });
    expect(rows[0].resolvedAt).not.toBeNull();
    expect(await db.select().from(notificationQueue)).toHaveLength(0);

    // A replay is still a no-op.
    await processEvent(ev, own);
    expect(await db.select().from(reports)).toHaveLength(1);
  });

  it("keeps a report about an outside account whose content IS on this relay", async () => {
    const post = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" }, ZARA.secretKey);
    await insertRelayEvent(post);
    await processEvent(outsideReport(post.id), own);
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({
      status: "open",
      resolution: null,
      triage: { origin: "local", signals: ["target_event_here", "target_content_here"] },
    });
    await vi.waitFor(async () => {
      expect(await db.select().from(notificationQueue)).toHaveLength(1);
    });
  });

  it("keeps a user report about an account that has published here, even when the reporter has not", async () => {
    const reaction = finalizeEvent({ kind: 7, created_at: Math.floor(Date.now() / 1000), tags: [["e", unique()]], content: "+" }, ZARA.secretKey);
    await insertRelayEvent(reaction);
    const ev = outsideReport("", { tags: [["p", OUTSIDE_TARGET, "spam"]] });
    await processEvent(ev, own);
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({ targetType: "user", status: "open", triage: { origin: "local", signals: ["target_content_here"] } });
  });

  it("keeps a report whose target is an app user, whatever the reporter is", async () => {
    await db.insert(nip05Identities).values({ username: "zara", pubkey: OUTSIDE_TARGET });
    await processEvent(outsideReport(unique()), own);
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({ status: "open", triage: { origin: "local", signals: ["target_app_user"] } });
  });

  it("keeps a report whose reporter is an app user by their own DM relay list here", async () => {
    const list = finalizeEvent(
      { kind: 10050, created_at: Math.floor(Date.now() / 1000), tags: [["relay", config.publicRelayUrl]], content: "" },
      JAYDEE.secretKey,
    );
    await insertRelayEvent(list);
    await processEvent(outsideReport(unique()), own);
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({ status: "open", triage: { origin: "local", signals: ["reporter_app_user"] } });
    await deleteRelayEventsByPubkey([JAYDEE.pubkey]);
  });

  it("folds a foreign copy into the open report the same reporter filed through the app", async () => {
    const targetId = unique();
    // Through the app first (NIP-98 at the gateway → source http).
    const viaApp = await reportService.file({
      source: "http", reporterPubkey: JAYDEE.pubkey, reporterIpHash: null, targetType: "event", targetEventId: targetId,
      targetCoordinate: null, targetPubkey: OUTSIDE_TARGET, targetKind: 1, targetContext: null, category: "spam", note: null,
      reportEventId: null,
    });
    await viaApp.notified;
    await processEvent(outsideReport(targetId), own);
    const rows = await db.select().from(reports);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(viaApp.report.id);
    expect(rows[0].status).toBe("open");
  });

  it("never judges a DM report foreign (only the apps file one, naming our wrap)", async () => {
    const ev = outsideReport("", { tags: [["p", OUTSIDE_TARGET, "spam"], ["wrap", unique()], ["L", "app.soot.report.target"], ["l", "dm", "app.soot.report.target"]] });
    await processEvent(ev, own);
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({ targetType: "dm", status: "open", triage: { origin: "local", signals: ["platform_target_type"] } });
  });

  it("keeps the report when the footprint lookup fails, flagged for the reviewer", async () => {
    const realExecute = db.execute.bind(db);
    vi.spyOn(db, "execute").mockImplementation((query) => {
      if (JSON.stringify(query).includes("nip05_identities")) {
        return Promise.reject(new Error("boom")) as never;
      }
      return realExecute(query as never) as never;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await processEvent(outsideReport(unique()), own);
    vi.restoreAllMocks();
    const [row] = await db.select().from(reports);
    expect(row).toMatchObject({ status: "open", triage: { origin: "local", signals: ["lookup_failed"] } });
  });

  describe("backfill (reports triage)", () => {
    async function seedOpen(reporter: string, target: string, targetEventId: string | null, source: "nostr" | "http" = "nostr") {
      const [row] = await db
        .insert(reports)
        .values({
          id: `bf-${seq++}`, source, reporterPubkey: reporter, targetType: targetEventId ? "event" : "user", targetEventId,
          targetPubkey: target, category: "spam", reportEventId: source === "nostr" ? unique() : null,
        })
        .returning();
      return row;
    }

    it("lists the open relay-sourced reports that are foreign and closes them only with apply", async () => {
      const foreign1 = await seedOpen(JAYDEE.pubkey, OUTSIDE_TARGET, unique());
      const foreign2 = await seedOpen(JAYDEE.pubkey, OUTSIDE_TARGET, null);
      // Local: the reporter is an app user.
      await db.insert(nip05Identities).values({ username: "marcus", pubkey: MARCUS.pubkey });
      const local = await seedOpen(MARCUS.pubkey, OUTSIDE_TARGET, unique());
      // Never touched: HTTP, already resolved.
      // (by a third account: an HTTP report would make its reporter an app user)
      const http = await seedOpen(SAGE.pubkey, OUTSIDE_TARGET, unique(), "http");
      const actioned = await seedOpen(JAYDEE.pubkey, OUTSIDE_TARGET, unique());
      await db.update(reports).set({ status: "actioned", resolution: "remove_event" }).where(eq(reports.id, actioned.id));

      const dry = await reportService.triageOpenForeign({ apply: false, actor: "cli:test" });
      expect(dry).toEqual({ checked: 3, foreign: expect.arrayContaining([foreign1.id, foreign2.id]), closed: 0 });
      expect(dry.foreign).toHaveLength(2);
      expect((await db.select().from(reports).where(eq(reports.status, "open"))).length).toBe(4);

      const applied = await reportService.triageOpenForeign({ apply: true, actor: "cli:test" });
      expect(applied.closed).toBe(2);
      for (const id of [foreign1.id, foreign2.id]) {
        const [row] = await db.select().from(reports).where(eq(reports.id, id));
        expect(row).toMatchObject({ status: "dismissed", resolution: FOREIGN_RESOLUTION, resolvedBy: "cli:test", triage: { origin: "foreign" } });
        expect(row.resolvedAt).not.toBeNull();
      }
      for (const id of [local.id, http.id]) {
        const [row] = await db.select().from(reports).where(eq(reports.id, id));
        expect(row.status).toBe("open");
      }
      const [stillActioned] = await db.select().from(reports).where(eq(reports.id, actioned.id));
      expect(stillActioned).toMatchObject({ status: "actioned", resolution: "remove_event" });

      // Idempotent.
      expect(await reportService.triageOpenForeign({ apply: true, actor: "cli:test" })).toEqual({ checked: 1, foreign: [], closed: 0 });
    });

    it("does not overwrite a report a reviewer resolved while the backfill ran", async () => {
      const row = await seedOpen(JAYDEE.pubkey, OUTSIDE_TARGET, unique());
      const result = await reportService.triageOpenForeign({
        apply: true,
        actor: "cli:test",
        classify: async () => {
          await db.update(reports).set({ status: "actioned", resolution: "escalate" }).where(eq(reports.id, row.id));
          return { origin: "foreign", signals: [] };
        },
      });
      expect(result).toEqual({ checked: 1, foreign: [row.id], closed: 0 });
      const [after] = await db.select().from(reports).where(eq(reports.id, row.id));
      expect(after).toMatchObject({ status: "actioned", resolution: "escalate" });
    });
  });
});

describe("ingest blocks", () => {
  it("indexes nothing from a suspended author (except its own deletions)", async () => {
    await db.execute(
      sql`INSERT INTO relay.suspended_pubkeys (pubkey, suspended_by) VALUES (${MARCUS.pubkey}, 'admin')`,
    );
    suspensionService.invalidate();
    const add = getMeilisearchClient().index("events").addDocuments as Mock;
    add.mockClear();
    const post = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" }, MARCUS.secretKey);
    await processEvent(post, own);
    expect(add).not.toHaveBeenCalled();

    const fromOther = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "hi" }, SAGE.secretKey);
    await processEvent(fromOther, own);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("re-ingests nothing a deleted account published up to its vanish, nor wraps addressed to it", async () => {
    const vanishAt = Math.floor(Date.now() / 1000);
    await db.insert(accountDeletions).values({
      pubkey: MARCUS.pubkey,
      vanishEventId: "v".repeat(64),
      vanishCreatedAt: vanishAt,
      vanishEvent: {},
      status: "complete",
    });
    accountDeletionService.invalidate();
    const add = getMeilisearchClient().index("events").addDocuments as Mock;
    add.mockClear();

    const old = finalizeEvent({ kind: 1, created_at: vanishAt - 100, tags: [], content: "old" }, MARCUS.secretKey);
    await processEvent(old, own);
    expect(add).not.toHaveBeenCalled();

    // Their report filed before the vanish is not re-filed either.
    const r = finalizeEvent(
      { kind: 1984, created_at: vanishAt - 5, tags: [["p", SAGE.pubkey, "spam"]], content: "" },
      MARCUS.secretKey,
    );
    await processEvent(r, own);
    expect(await db.select().from(reports).where(eq(reports.reportEventId, r.id))).toHaveLength(0);

    // An event dated after the vanish (the same key starting over) is not blocked...
    const later = finalizeEvent({ kind: 1, created_at: vanishAt + 5, tags: [], content: "new" }, MARCUS.secretKey);
    expect(await authorBlocked(later)).toBe(false);
    // ...but a gift wrap addressed to the deleted pubkey is, whoever wrapped it.
    const wrap = finalizeEvent(
      { kind: 1059, created_at: vanishAt + 5, tags: [["p", MARCUS.pubkey]], content: "cipher" },
      SAGE.secretKey,
    );
    expect(await authorBlocked(wrap)).toBe(true);
  });
});
