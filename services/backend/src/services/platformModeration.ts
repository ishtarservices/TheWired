import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { moderationAuditLog } from "../db/schema/moderation.js";
import { config } from "../config.js";
import { nanoid } from "../lib/id.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";
import { parseCoordinate } from "../lib/reports/reportInput.js";
import { musicService } from "./musicService.js";
import { suspensionService } from "./suspensionService.js";

/**
 * Operator moderation actions (App Store 1.2), shared by the admin routes and
 * the `pnpm reports:*` CLI. Each is reversible where it can be and each writes
 * `app.moderation_audit_log` (space_id NULL = platform level):
 *
 *   remove_event   tombstone + delete from relay.events + Meilisearch.
 *                  Reversible: `restoreEvent` re-publishes the kept copy.
 *   remove_music   the existing `musicService.deleteMusic` path (blobs, HLS,
 *                  plays, counts) + tombstones. The event is restorable, the
 *                  deleted audio is not.
 *   suspend_pubkey relay.suspended_pubkeys (the relay refuses writes) + hidden
 *                  from API responses. Reversible: `liftSuspension`.
 *
 * The relay owns relay.tombstones / relay.suspended_pubkeys (relay migration
 * 006) and enforces them on its write path; deploy the relay first.
 */

export interface RelayEventRow {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface ActionContext {
  /** Admin pubkey (or "cli:<user>" from the CLI). */
  actor: string;
  reportId?: string;
  note?: string | null;
}

const MUSIC_KINDS = new Set([31683, 33123]);

/** Write one platform-level audit row. Never throws into the action. */
export async function logPlatformAudit(
  actor: string,
  action: string,
  targetPubkey: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(moderationAuditLog).values({
      id: nanoid(12),
      spaceId: null,
      actorPubkey: actor,
      action,
      targetPubkey,
      details: JSON.stringify(details),
    });
  } catch (err) {
    console.error("[moderation] audit write failed:", (err as Error).message);
  }
}

export async function getRelayEvent(eventId: string): Promise<RelayEventRow | null> {
  const rows = (await db.execute(
    sql`SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events WHERE id = ${eventId} LIMIT 1`,
  )) as unknown as RelayEventRow[];
  return rows[0] ? { ...rows[0], created_at: Number(rows[0].created_at) } : null;
}

/** The current event at an addressable coordinate, if the relay holds one. */
export async function getEventByCoordinate(coordinate: string): Promise<RelayEventRow | null> {
  const c = parseCoordinate(coordinate);
  if (!c) return null;
  const rows = (await db.execute(
    sql`SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events
        WHERE kind = ${c.kind} AND pubkey = ${c.pubkey} AND d_tag = ${c.d}
        ORDER BY created_at DESC LIMIT 1`,
  )) as unknown as RelayEventRow[];
  return rows[0] ? { ...rows[0], created_at: Number(rows[0].created_at) } : null;
}

/** A removed event's tombstone (with its kept copy), active or restored. */
export async function getTombstone(
  eventId: string,
): Promise<{ event: RelayEventRow | null; restored: boolean } | null> {
  const rows = (await db.execute(
    sql`SELECT event, restored_at FROM relay.tombstones WHERE event_id = ${eventId} LIMIT 1`,
  )) as unknown as Array<{ event: RelayEventRow | null; restored_at: Date | null }>;
  if (!rows[0]) return null;
  return { event: rows[0].event, restored: rows[0].restored_at !== null };
}

async function tombstone(row: RelayEventRow, ctx: ActionContext): Promise<void> {
  await db.execute(
    sql`INSERT INTO relay.tombstones (event_id, pubkey, kind, event, reason, report_id, removed_by)
        VALUES (${row.id}, ${row.pubkey}, ${row.kind}, ${JSON.stringify(row)}::jsonb,
                ${ctx.note ?? null}, ${ctx.reportId ?? null}, ${ctx.actor})
        ON CONFLICT (event_id) DO UPDATE
          SET restored_at = NULL, restored_by = NULL, removed_at = NOW(),
              removed_by = EXCLUDED.removed_by, reason = EXCLUDED.reason,
              report_id = EXCLUDED.report_id, event = COALESCE(EXCLUDED.event, relay.tombstones.event)`,
  );
}

export type RemoveResult =
  | { ok: true; removed: string[]; pubkey: string; music: boolean }
  | { ok: false; code: "EVENT_NOT_FOUND" | "NOT_MUSIC" };

/**
 * Remove one event. A track / album is routed to `removeMusic` so its blobs go
 * too. Idempotent: an event already tombstoned reports ok with nothing removed.
 */
export async function removeEvent(target: { eventId?: string | null; coordinate?: string | null }, ctx: ActionContext): Promise<RemoveResult> {
  let row = target.eventId ? await getRelayEvent(target.eventId) : null;
  if (!row && target.coordinate) row = await getEventByCoordinate(target.coordinate);
  if (!row) {
    const tomb = target.eventId ? await getTombstone(target.eventId) : null;
    if (tomb && !tomb.restored) {
      return { ok: true, removed: [], pubkey: tomb.event?.pubkey ?? "", music: false };
    }
    return { ok: false, code: "EVENT_NOT_FOUND" };
  }
  if (MUSIC_KINDS.has(row.kind)) {
    const d = row.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return removeMusic({ coordinate: `${row.kind}:${row.pubkey}:${d}` }, ctx);
  }

  // Tombstone first, so the relay refuses a re-publish during the delete.
  await tombstone(row, ctx);
  await db.execute(sql`DELETE FROM relay.events WHERE id = ${row.id}`);
  try {
    await getMeilisearchClient().index("events").deleteDocument(row.id);
  } catch {
    // not indexed
  }
  await logPlatformAudit(ctx.actor, "report_remove_event", row.pubkey, {
    reportId: ctx.reportId,
    eventId: row.id,
    kind: row.kind,
    note: ctx.note ?? undefined,
  });
  return { ok: true, removed: [row.id], pubkey: row.pubkey, music: false };
}

/** Remove a track / album (every stored version at the coordinate). */
export async function removeMusic(
  target: { eventId?: string | null; coordinate?: string | null },
  ctx: ActionContext,
): Promise<RemoveResult> {
  let coordinate = target.coordinate ?? null;
  if (!coordinate && target.eventId) {
    const row = await getRelayEvent(target.eventId);
    if (row && MUSIC_KINDS.has(row.kind)) {
      const d = row.tags.find((t) => t[0] === "d")?.[1] ?? "";
      coordinate = `${row.kind}:${row.pubkey}:${d}`;
    } else if (row) {
      return { ok: false, code: "NOT_MUSIC" };
    }
  }
  const c = coordinate ? parseCoordinate(coordinate) : null;
  if (!c) {
    const tomb = target.eventId ? await getTombstone(target.eventId) : null;
    if (tomb && !tomb.restored) return { ok: true, removed: [], pubkey: tomb.event?.pubkey ?? "", music: true };
    return { ok: false, code: "EVENT_NOT_FOUND" };
  }
  if (!MUSIC_KINDS.has(c.kind)) return { ok: false, code: "NOT_MUSIC" };

  const rows = (await db.execute(
    sql`SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events
        WHERE kind = ${c.kind} AND pubkey = ${c.pubkey}
          AND tags @> ${JSON.stringify([["d", c.d]])}::jsonb`,
  )) as unknown as RelayEventRow[];
  if (rows.length === 0) {
    const tomb = target.eventId ? await getTombstone(target.eventId) : null;
    if (tomb && !tomb.restored) return { ok: true, removed: [], pubkey: c.pubkey, music: true };
    return { ok: false, code: "EVENT_NOT_FOUND" };
  }
  for (const row of rows) await tombstone({ ...row, created_at: Number(row.created_at) }, ctx);
  await musicService.deleteMusic(c.kind, c.pubkey, c.d);
  await logPlatformAudit(ctx.actor, "report_remove_music", c.pubkey, {
    reportId: ctx.reportId,
    coordinate: `${c.kind}:${c.pubkey}:${c.d}`,
    eventIds: rows.map((r) => r.id),
    note: ctx.note ?? undefined,
  });
  return { ok: true, removed: rows.map((r) => r.id), pubkey: c.pubkey, music: true };
}

/** Suspend an account: the relay refuses its writes, the API hides it. */
export async function suspendPubkey(pubkey: string, ctx: ActionContext): Promise<void> {
  await db.execute(
    sql`INSERT INTO relay.suspended_pubkeys (pubkey, reason, report_id, suspended_by)
        VALUES (${pubkey}, ${ctx.note ?? null}, ${ctx.reportId ?? null}, ${ctx.actor})
        ON CONFLICT (pubkey) DO UPDATE
          SET lifted_at = NULL, lifted_by = NULL, suspended_at = NOW(),
              suspended_by = EXCLUDED.suspended_by, reason = EXCLUDED.reason,
              report_id = EXCLUDED.report_id`,
  );
  suspensionService.invalidate();
  await suspensionService.purgeSearchDocs(pubkey);
  await logPlatformAudit(ctx.actor, "report_suspend_pubkey", pubkey, {
    reportId: ctx.reportId,
    note: ctx.note ?? undefined,
  });
}

/** Lift a suspension. False when the pubkey was not suspended. */
export async function liftSuspension(pubkey: string, actor: string, note?: string | null): Promise<boolean> {
  const rows = (await db.execute(
    sql`UPDATE relay.suspended_pubkeys SET lifted_at = NOW(), lifted_by = ${actor}
        WHERE pubkey = ${pubkey} AND lifted_at IS NULL RETURNING pubkey`,
  )) as unknown as unknown[];
  if (rows.length === 0) return false;
  suspensionService.invalidate();
  await suspensionService.reindexSearchDocs(pubkey);
  await logPlatformAudit(actor, "suspension_lift", pubkey, { note: note ?? undefined });
  return true;
}

/** Send one signed event to the platform relay and wait for its OK. */
export async function publishToRelay(
  event: RelayEventRow,
  url: string = config.relayUrl,
  timeoutMs = 5000,
): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(url);
    const finish = (r: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, message: "timeout" }), timeoutMs);
    ws.addEventListener("open", () => ws.send(JSON.stringify(["EVENT", event])));
    ws.addEventListener("message", (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg[0] === "OK" && msg[1] === event.id) finish({ ok: msg[2] === true, message: String(msg[3] ?? "") });
      } catch {
        // ignore non-JSON frames
      }
    });
    ws.addEventListener("error", () => finish({ ok: false, message: "relay unreachable" }));
  });
}

export type RestoreResult =
  | { ok: true }
  | { ok: false; code: "NOT_REMOVED" | "NO_COPY" }
  | { ok: false; code: "RELAY_REFUSED"; message: string };

/**
 * Undo a removal: clear the tombstone and re-publish the kept copy to the
 * relay (the ingester re-indexes it like any new event). The tombstone has to
 * be cleared first — the relay refuses a tombstoned id — and is put back if
 * the relay does not take the event, so a failed restore leaves the removal in
 * force rather than an event that is neither removed nor back. Deleted audio
 * blobs are not recoverable — a restored track needs its owner to re-upload.
 */
export async function restoreEvent(eventId: string, actor: string, note?: string | null): Promise<RestoreResult> {
  const tomb = await getTombstone(eventId);
  if (!tomb || tomb.restored) return { ok: false, code: "NOT_REMOVED" };
  if (!tomb.event) return { ok: false, code: "NO_COPY" };
  await db.execute(
    sql`UPDATE relay.tombstones SET restored_at = NOW(), restored_by = ${actor} WHERE event_id = ${eventId}`,
  );
  const published = await publishToRelay(tomb.event);
  if (!published.ok) {
    await db.execute(
      sql`UPDATE relay.tombstones SET restored_at = NULL, restored_by = NULL WHERE event_id = ${eventId}`,
    );
    return { ok: false, code: "RELAY_REFUSED", message: published.message };
  }
  await logPlatformAudit(actor, "event_restore", tomb.event.pubkey, { eventId, note: note ?? undefined });
  return { ok: true };
}
