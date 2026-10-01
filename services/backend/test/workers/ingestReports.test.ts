/**
 * The nostr door for reports, end to end through `processEvent`: a signed
 * kind 1984 in soot's layout from the platform relay becomes one app.reports
 * row (replays are no-ops); a foreign relay cannot file one. Plus the ingest
 * blocks that moderation and account deletion rely on.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeEach, afterAll, type Mock } from "vitest";
import { eq, sql } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";
import { resetRelayModeration } from "../helpers/relayEvents.js";
import { db } from "../../src/db/connection.js";
import { reports, accountDeletions } from "../../src/db/schema/reports.js";
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
    });
  });

  it("ignores a forged signature and a foreign relay's copy", async () => {
    const ev = sootReport("c".repeat(64));
    await processEvent({ ...ev, content: "tampered" }, own);
    await processEvent(ev, ext);
    expect(await db.select().from(reports)).toHaveLength(0);
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
