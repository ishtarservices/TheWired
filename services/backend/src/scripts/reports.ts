/**
 * Operator CLI for user reports (App Store 1.2) — the same service functions
 * as the admin routes, for when the in-app inbox is not at hand.
 *
 * Dev (repo root or services/backend):
 *   pnpm reports:list [open|actioned|dismissed]
 *   pnpm reports:show <id>
 *   pnpm reports:resolve <id> <dismiss|remove_event|remove_music|suspend_pubkey|escalate> [note…]
 *   pnpm reports:lift <pubkey> [note…]        (reverses suspend_pubkey)
 *   pnpm reports:restore <eventId> [note…]    (reverses remove_event / remove_music)
 * Production (inside the backend container):
 *   node dist/scripts/reports.js <command> …
 *
 * Actions are attributed to REPORTS_ACTOR, else the first ADMIN_PUBKEYS entry,
 * else "cli".
 */
import { config } from "../config.js";
import { REPORT_ACTIONS, reportService, serializeReport, type ReportAction } from "../services/reportService.js";
import { liftSuspension, restoreEvent } from "../services/platformModeration.js";

const USAGE = `usage:
  reports list [open|actioned|dismissed]
  reports show <id>
  reports resolve <id> <${REPORT_ACTIONS.join("|")}> [note…]
  reports lift <pubkey> [note…]
  reports restore <eventId> [note…]`;

const actor = process.env.REPORTS_ACTOR || config.adminPubkeys[0] || "cli";

function short(v: string | undefined, n = 12): string {
  return v ? `${v.slice(0, n)}…` : "-";
}

async function list(status: string): Promise<void> {
  if (status !== "open" && status !== "actioned" && status !== "dismissed") throw new Error(USAGE);
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await reportService.list({ status, cursor, limit: 100 });
    if (!page) break;
    for (const r of page.reports.map(serializeReport)) {
      total++;
      const target = r.targetEventId ?? r.targetCoordinate ?? r.targetPubkey;
      console.log(
        `${r.id}  ${r.createdAt.slice(0, 16)}  ${r.category.padEnd(13)} ${r.targetType.padEnd(6)} ${short(target)}` +
          `  by ${r.reporterPubkey ? short(r.reporterPubkey, 8) : r.source === "http" ? "guest" : "-"}` +
          (r.resolution ? `  → ${r.resolution}` : ""),
      );
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  console.log(`${total} ${status} report(s)`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "list":
      return list(args[0] ?? "open");
    case "show": {
      const row = args[0] ? await reportService.get(args[0]) : null;
      if (!row) throw new Error(args[0] ? `no report ${args[0]}` : USAGE);
      console.log(JSON.stringify(await reportService.detail(row), null, 2));
      return;
    }
    case "resolve": {
      const [id, action, ...note] = args;
      if (!id || !REPORT_ACTIONS.includes(action as ReportAction)) throw new Error(USAGE);
      const result = await reportService.resolve(id, action as ReportAction, actor, note.join(" ") || null);
      if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
      console.log(JSON.stringify({ report: serializeReport(result.report), closedSiblings: result.siblings, ...result.detail }, null, 2));
      return;
    }
    case "lift": {
      const [pubkey, ...note] = args;
      if (!pubkey) throw new Error(USAGE);
      console.log((await liftSuspension(pubkey, actor, note.join(" ") || null)) ? "lifted" : "not suspended");
      return;
    }
    case "restore": {
      const [eventId, ...note] = args;
      if (!eventId) throw new Error(USAGE);
      console.log(JSON.stringify(await restoreEvent(eventId, actor, note.join(" ") || null)));
      return;
    }
    default:
      throw new Error(USAGE);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
