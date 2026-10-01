import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import type { ReportRow } from "../db/schema/reports.js";
import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";
import { enqueueNotification } from "./notificationEnqueue.js";

/**
 * Operator notification for every new report — the terms promise a look
 * within 24 hours, which only happens if someone is told.
 *
 *  1. PUSH (primary): one notification per ADMIN_PUBKEYS account through the
 *     ordinary queue → dispatcher → Expo / web-push path, so it reaches every
 *     device the admin registered. Expo and APNs see the payload in plaintext,
 *     so it carries the report id and the category only — never the reporter,
 *     the target or the note. The app fetches the rest over NIP-98
 *     (GET /admin/reports/:id). Data: { type: "report", reportId }.
 *  2. WEBHOOK (backup + written record): REPORT_WEBHOOK_URL, Discord/Slack
 *     compatible ({ content, text }). Ids and counts only — no reporter
 *     identity and no note, since the webhook lands on a third party.
 */

const WEBHOOK_TIMEOUT_MS = 5000;

const TARGET_NOUN: Record<ReportRow["targetType"], string> = {
  event: "a post",
  user: "an account",
  dm: "a message",
  voice: "a voice room",
  track: "a track",
  album: "an album",
};

/** Deep link soot's admin inbox opens. */
export function reportDeepLink(id: string): string {
  return `soot://admin/reports/${id}`;
}

async function openCount(row: ReportRow): Promise<number> {
  if (!row.targetPubkey) return 1;
  try {
    const [r] = (await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM app.reports WHERE target_pubkey = ${row.targetPubkey} AND status = 'open'`,
    )) as unknown as Array<{ n: number }>;
    return r?.n ?? 1;
  } catch {
    return 1;
  }
}

/** The webhook text: what was reported and where to look, nothing personal. */
export async function webhookMessage(row: ReportRow): Promise<string> {
  const lines = [`**new report** \`${row.id}\` — ${row.category} · ${TARGET_NOUN[row.targetType]} (${row.source})`];
  if (row.targetEventId && row.targetType !== "dm") lines.push(`event: \`${row.targetEventId}\``);
  if (row.targetType === "dm" && row.targetEventId) lines.push(`gift wrap: \`${row.targetEventId}\` (unreadable — judge the pattern)`);
  if (row.targetCoordinate) lines.push(`coordinate: \`${row.targetCoordinate}\``);
  if (row.targetPubkey) {
    lines.push(`account: \`${row.targetPubkey}\` · open reports on it: ${await openCount(row)}`);
  }
  lines.push(`review: \`pnpm reports:show ${row.id}\``);
  return lines.join("\n");
}

/** A report flood (fresh keys are free) must not get the webhook revoked by
 *  Discord/Slack rate limits: at most this many posts per window, then one
 *  "more are arriving" line. Every report is still in app.reports and the
 *  admin pushes collapse on their own. */
export const WEBHOOK_BURST = 20;
export const WEBHOOK_WINDOW_SEC = 600;
const WEBHOOK_WINDOW_KEY = "reports:webhook:window";

async function send(content: string): Promise<void> {
  const res = await fetch(config.reportWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Discord reads `content`, Slack reads `text`; each ignores the other.
    body: JSON.stringify({ content, text: content }),
    redirect: "error",
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`report webhook answered ${res.status}`);
}

async function postWebhook(row: ReportRow): Promise<void> {
  if (!config.reportWebhookUrl) return;
  const redis = getRedis();
  // Create the window WITH its TTL in one command, then count: an INCR-then-
  // EXPIRE pair could leave a key without a TTL and mute the webhook for good.
  await redis.set(WEBHOOK_WINDOW_KEY, "0", "EX", WEBHOOK_WINDOW_SEC, "NX");
  const n = await redis.incr(WEBHOOK_WINDOW_KEY);
  if (n > WEBHOOK_BURST) {
    if (n === WEBHOOK_BURST + 1) {
      await send(
        `**reports are arriving faster than ${WEBHOOK_BURST} per ${WEBHOOK_WINDOW_SEC / 60} minutes** — ` +
          "the rest of this window is not posted here; review with `pnpm reports:list`",
      );
    }
    return;
  }
  await send(await webhookMessage(row));
}

async function pushAdmins(row: ReportRow): Promise<void> {
  for (const admin of config.adminPubkeys) {
    await enqueueNotification({
      pubkey: admin,
      type: "report",
      title: "new report",
      body: `${row.category} · ${TARGET_NOUN[row.targetType]}`,
      url: reportDeepLink(row.id),
      collapseKey: "report",
      data: { reportId: row.id },
    });
  }
}

/** Both channels; one failing never stops the other. */
export async function notifyNewReport(row: ReportRow): Promise<void> {
  const results = await Promise.allSettled([pushAdmins(row), postWebhook(row)]);
  for (const r of results) {
    if (r.status === "rejected") console.error("[reports] notification failed:", (r.reason as Error)?.message ?? r.reason);
  }
}
