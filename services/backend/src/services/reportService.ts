import { createHmac } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { reports, type ReportRow, type ReportStatus } from "../db/schema/reports.js";
import { cachedProfiles } from "../db/schema/profiles.js";
import { config } from "../config.js";
import { nanoid } from "../lib/id.js";
import type { ReportInput } from "../lib/reports/reportInput.js";
import {
  getEventByCoordinate,
  getRelayEvent,
  getTombstone,
  logPlatformAudit,
  removeEvent,
  removeMusic,
  suspendPubkey,
  type ActionContext,
  type RelayEventRow,
} from "./platformModeration.js";
import { notifyNewReport } from "./reportNotifier.js";
import { suspensionService } from "./suspensionService.js";

/**
 * User reports (App Store 1.2). Reports are input, not verdicts: nothing is
 * removed because it was reported — a person resolves each one through the
 * admin routes or the `pnpm reports:*` CLI. Contract shared with soot's admin
 * inbox (GET /admin/reports, GET /admin/reports/:id, POST …/resolve).
 */

export const REPORT_ACTIONS = ["dismiss", "remove_event", "remove_music", "suspend_pubkey", "escalate"] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** How far back "prior reports" against the same target look. */
const PRIOR_WINDOW_DAYS = 90;

/** The wire shape (soot's admin inbox). Optional fields are omitted, not null. */
export interface ReportDTO {
  id: string;
  source: ReportRow["source"];
  reporterPubkey?: string;
  targetType: ReportRow["targetType"];
  targetEventId?: string;
  targetCoordinate?: string;
  targetPubkey?: string;
  targetKind?: number;
  targetContext?: Record<string, string>;
  category: ReportRow["category"];
  note?: string;
  status: ReportStatus;
  resolution?: string;
  resolutionNote?: string;
  createdAt: string;
  resolvedAt?: string;
  triage?: Record<string, unknown>;
}

export function serializeReport(r: ReportRow): ReportDTO {
  const out: ReportDTO = {
    id: r.id,
    source: r.source,
    targetType: r.targetType,
    category: r.category,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
  if (r.reporterPubkey) out.reporterPubkey = r.reporterPubkey;
  if (r.targetEventId) out.targetEventId = r.targetEventId;
  if (r.targetCoordinate) out.targetCoordinate = r.targetCoordinate;
  if (r.targetPubkey) out.targetPubkey = r.targetPubkey;
  if (r.targetKind !== null && r.targetKind !== undefined) out.targetKind = r.targetKind;
  if (r.targetContext && Object.keys(r.targetContext).length > 0) {
    out.targetContext = r.targetContext as Record<string, string>;
  }
  if (r.note) out.note = r.note;
  if (r.resolution) out.resolution = r.resolution;
  if (r.resolutionNote) out.resolutionNote = r.resolutionNote;
  if (r.resolvedAt) out.resolvedAt = r.resolvedAt.toISOString();
  if (r.triage) out.triage = r.triage;
  return out;
}

/** Keyed hash of a guest reporter's IP — stable for flood detection, never reversible. */
export function hashReporterIp(ip: string): string {
  return createHmac("sha256", config.reportIpSalt).update(`report-ip:${ip.trim()}`).digest("hex");
}

/** The open report the dedupe index matched for this input. */
async function findOpenDuplicate(input: ReportInput): Promise<ReportRow | null> {
  const reporter = input.reporterPubkey
    ? eq(reports.reporterPubkey, input.reporterPubkey)
    : input.reporterIpHash
      ? and(sql`${reports.reporterPubkey} IS NULL`, eq(reports.reporterIpHash, input.reporterIpHash))
      : null;
  if (!reporter) return null;
  const [row] = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.status, "open"),
        reporter,
        eq(reports.targetType, input.targetType),
        sql`COALESCE(${reports.targetEventId}, '') = ${input.targetEventId ?? ""}`,
        sql`COALESCE(${reports.targetCoordinate}, '') = ${input.targetCoordinate ?? ""}`,
        sql`COALESCE(${reports.targetPubkey}, '') = ${input.targetPubkey ?? ""}`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface FileResult {
  report: ReportRow;
  created: boolean;
  /** Settles when the operator notification (push enqueue + webhook) is done. */
  notified: Promise<void>;
}

export const reportService = {
  /**
   * File a report. Deduped on (reporter, target) while open — a repeat (or a
   * re-ingested kind 1984) returns the existing row and notifies nobody.
   */
  async file(input: ReportInput, attempt = 0): Promise<FileResult> {
    const inserted = await db
      .insert(reports)
      .values({
        id: nanoid(16),
        source: input.source,
        reporterPubkey: input.reporterPubkey,
        reporterIpHash: input.reporterIpHash,
        targetType: input.targetType,
        targetEventId: input.targetEventId,
        targetCoordinate: input.targetCoordinate,
        targetPubkey: input.targetPubkey,
        targetKind: input.targetKind,
        targetContext: input.targetContext,
        category: input.category,
        note: input.note,
        reportEventId: input.reportEventId,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      const report = inserted[0];
      const notified = notifyNewReport(report).catch((err) => {
        console.error("[reports] notify failed:", (err as Error).message);
      });
      return { report, created: true, notified };
    }

    // A replayed kind 1984 matches its own report_event_id; the same report
    // through the other door (soot falls back to POST /reports when the relay
    // publish fails) matches the open (reporter, target) duplicate instead.
    const byEvent = input.reportEventId
      ? (await db.select().from(reports).where(eq(reports.reportEventId, input.reportEventId)).limit(1))[0]
      : undefined;
    const existing = byEvent ?? (await findOpenDuplicate(input));
    if (!existing) {
      // The open duplicate was resolved between the conflict and the lookup:
      // the target is no longer deduped, so this report files fresh.
      if (attempt === 0) return this.file(input, 1);
      throw new Error("report conflicted but no matching row was found");
    }
    return { report: existing, created: false, notified: Promise.resolve() };
  },

  async get(id: string): Promise<ReportRow | null> {
    const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return row ?? null;
  },

  /** Newest first, keyset-paginated. */
  async list(opts: { status: ReportStatus; cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const conditions = [eq(reports.status, opts.status)];
    const after = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !after) return null;
    if (after) {
      // Compare against the cursor row's stored timestamp: Postgres keeps
      // microseconds, a JS Date only milliseconds.
      conditions.push(
        sql`(${reports.createdAt}, ${reports.id}) < (SELECT r.created_at, r.id FROM app.reports r WHERE r.id = ${after})`,
      );
    }
    const rows = await db
      .select()
      .from(reports)
      .where(and(...conditions))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      reports: page,
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  },

  /** The report plus what the reviewer needs to judge it. */
  async detail(row: ReportRow) {
    let event: RelayEventRow | null = null;
    let removed = false;
    if (row.targetType !== "dm" && (row.targetEventId || row.targetCoordinate)) {
      if (row.targetEventId) event = await getRelayEvent(row.targetEventId);
      if (!event && row.targetCoordinate) event = await getEventByCoordinate(row.targetCoordinate);
      if (!event && row.targetEventId) {
        const tomb = await getTombstone(row.targetEventId);
        if (tomb && !tomb.restored) {
          removed = true;
          event = tomb.event;
        }
      }
    }

    const pubkey = row.targetPubkey ?? event?.pubkey ?? null;
    let profile: Record<string, string> | undefined;
    if (pubkey) {
      const [p] = await db.select().from(cachedProfiles).where(eq(cachedProfiles.pubkey, pubkey)).limit(1);
      if (p) {
        profile = { pubkey };
        for (const [k, v] of Object.entries({
          name: p.name,
          displayName: p.displayName,
          picture: p.picture,
          about: p.about,
          nip05: p.nip05,
        })) {
          if (v) profile[k] = v;
        }
      }
    }

    // Prior reports: others against the same account (or, without one, the
    // same event / coordinate) in the window.
    const since = sql`NOW() - make_interval(days => ${PRIOR_WINDOW_DAYS})`;
    const sameTarget = pubkey
      ? sql`target_pubkey = ${pubkey}`
      : row.targetEventId
        ? sql`target_event_id = ${row.targetEventId}`
        : row.targetCoordinate
          ? sql`target_coordinate = ${row.targetCoordinate}`
          : null;
    let priorReports = 0;
    let distinctReporters = 0;
    if (sameTarget) {
      const [counts] = (await db.execute(
        sql`SELECT COUNT(*)::int AS n,
                   COUNT(DISTINCT COALESCE(reporter_pubkey, 'ip:' || reporter_ip_hash))::int AS reporters
            FROM app.reports
            WHERE ${sameTarget} AND id <> ${row.id} AND created_at >= ${since}`,
      )) as unknown as Array<{ n: number; reporters: number }>;
      priorReports = counts?.n ?? 0;
      distinctReporters = counts?.reporters ?? 0;
    }

    const target: Record<string, unknown> = { priorReports, distinctReporters };
    if (event) target.event = event;
    if (removed) target.removed = true;
    if (profile) target.profile = profile;
    if (pubkey) target.suspended = await suspensionService.isSuspended(pubkey);
    return { report: serializeReport(row), target };
  },

  /**
   * Apply an action and record it. Rules (soot's inbox relies on them):
   *  - a dismissed report takes no further action (409 REPORT_DISMISSED);
   *  - an actioned report can take another action (remove, then suspend), but
   *    cannot be dismissed (409 REPORT_ACTIONED);
   *  - `resolution` echoes the last action string.
   * remove_* / suspend_pubkey also close the other open reports on the same
   * target with the same resolution.
   */
  async resolve(
    id: string,
    action: ReportAction,
    actor: string,
    note?: string | null,
  ): Promise<
    | { ok: true; report: ReportRow; siblings: number; detail?: Record<string, unknown> }
    | { ok: false; status: number; code: string; error: string }
  > {
    const row = await this.get(id);
    if (!row) return { ok: false, status: 404, code: "NOT_FOUND", error: "Report not found" };
    if (row.status === "dismissed") {
      return { ok: false, status: 409, code: "REPORT_DISMISSED", error: "Report was dismissed" };
    }
    if (action === "dismiss" && row.status === "actioned") {
      return { ok: false, status: 409, code: "REPORT_ACTIONED", error: "Report was already actioned" };
    }

    const ctx: ActionContext = { actor, reportId: row.id, note: note ?? null };
    const detail: Record<string, unknown> = {};
    let siblingScope: ReturnType<typeof sql> | null = null;

    switch (action) {
      case "dismiss":
      case "escalate":
        await logPlatformAudit(actor, `report_${action}`, row.targetPubkey, {
          reportId: row.id,
          category: row.category,
          targetType: row.targetType,
          targetEventId: row.targetEventId ?? undefined,
          note: note ?? undefined,
        });
        break;
      case "remove_event":
      case "remove_music": {
        if (!["event", "track", "album"].includes(row.targetType) || (!row.targetEventId && !row.targetCoordinate)) {
          return { ok: false, status: 400, code: "TARGET_NOT_REMOVABLE", error: "This report does not name a removable event" };
        }
        const target = { eventId: row.targetEventId, coordinate: row.targetCoordinate };
        const result = action === "remove_music" ? await removeMusic(target, ctx) : await removeEvent(target, ctx);
        if (!result.ok) {
          return result.code === "NOT_MUSIC"
            ? { ok: false, status: 400, code: "NOT_MUSIC", error: "The reported event is not a track or album" }
            : { ok: false, status: 404, code: "EVENT_NOT_FOUND", error: "The reported event is not on this relay" };
        }
        detail.removed = result.removed;
        const ids = [row.targetEventId, ...result.removed].filter((v): v is string => !!v);
        const byId = ids.length
          ? sql`target_event_id IN (${sql.join(ids.map((v) => sql`${v}`), sql`, `)})`
          : sql`FALSE`;
        siblingScope = row.targetCoordinate
          ? sql`(${byId} OR target_coordinate = ${row.targetCoordinate})`
          : byId;
        break;
      }
      case "suspend_pubkey": {
        let pubkey = row.targetPubkey;
        if (!pubkey && row.targetEventId && row.targetType !== "dm") {
          pubkey = (await getRelayEvent(row.targetEventId))?.pubkey ?? null;
        }
        if (!pubkey) {
          return { ok: false, status: 400, code: "NO_TARGET_ACCOUNT", error: "This report does not name an account" };
        }
        await suspendPubkey(pubkey, ctx);
        detail.suspended = pubkey;
        siblingScope = sql`target_pubkey = ${pubkey}`;
        break;
      }
    }

    const status: ReportStatus = action === "dismiss" ? "dismissed" : "actioned";
    const [updated] = await db
      .update(reports)
      .set({ status, resolution: action, resolutionNote: note ?? null, resolvedBy: actor, resolvedAt: new Date() })
      .where(eq(reports.id, row.id))
      .returning();

    let siblings = 0;
    if (siblingScope) {
      const closed = (await db.execute(
        sql`UPDATE app.reports
            SET status = 'actioned', resolution = ${action}, resolved_by = ${actor}, resolved_at = NOW(),
                resolution_note = ${`via report ${row.id}`}
            WHERE status = 'open' AND id <> ${row.id} AND ${siblingScope}
            RETURNING id`,
      )) as unknown as unknown[];
      siblings = closed.length;
    }
    return { ok: true, report: updated, siblings, detail };
  },
};

/** Report ids match `[A-Za-z0-9._:-]{1,128}` (soot puts them in URLs and push data). */
export const REPORT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function encodeCursor(r: ReportRow): string {
  return Buffer.from(r.id).toString("base64url");
}

function decodeCursor(cursor: string): string | null {
  const id = Buffer.from(cursor, "base64url").toString("utf8");
  return REPORT_ID_PATTERN.test(id) ? id : null;
}
