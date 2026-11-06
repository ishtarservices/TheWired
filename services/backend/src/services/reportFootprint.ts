import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { config } from "../config.js";
import {
  classifyReportOrigin,
  listNamesRelay,
  relayUrlKey,
  LOOKUP_FAILED_VERDICT,
  type OriginVerdict,
  type ReportFootprint,
} from "../lib/reports/foreignReport.js";
import type { ReportInput } from "../lib/reports/reportInput.js";
import { getEventByCoordinate, getRelayEvent, getTombstone } from "./platformModeration.js";

/**
 * The DB side of foreign-report classification (lib/reports/foreignReport.ts
 * holds the rule). Every lookup is bounded: EXISTS per table, and at most the
 * newest kind 10002 + 10050 of an account.
 */

/** Kinds that say nothing about whose relay this is: wraps are addressed by
 *  anyone to anyone, and a report by an account is about someone else. */
const NON_CONTENT_KINDS = [1059, 1984];

const HEX64 = /^[0-9a-f]{64}$/;

/** The relay URLs this deployment answers to, as comparison keys. */
export function ownRelayKeys(): Set<string> {
  const keys = new Set<string>();
  for (const raw of [config.relayUrl, config.publicRelayUrl]) {
    const key = raw ? relayUrlKey(raw) : null;
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * Is this account one of the platform's users? Any one of: a nip05 name, a
 * mobile push device, a web push subscription, membership of a backend space,
 * an earlier report filed through the app (NIP-98 at the gateway), or an own
 * kind 10002 / 10050 stored here that names this relay (both apps publish
 * one at first login).
 */
export async function isAppUser(pubkey: string | null): Promise<boolean> {
  if (!pubkey || !HEX64.test(pubkey)) return false;
  const rows = (await db.execute(
    sql`SELECT (
          EXISTS (SELECT 1 FROM app.nip05_identities WHERE pubkey = ${pubkey})
       OR EXISTS (SELECT 1 FROM app.push_devices WHERE pubkey = ${pubkey})
       OR EXISTS (SELECT 1 FROM app.push_subscriptions WHERE pubkey = ${pubkey})
       OR EXISTS (SELECT 1 FROM app.space_members WHERE pubkey = ${pubkey})
       OR EXISTS (SELECT 1 FROM app.reports WHERE source = 'http' AND reporter_pubkey = ${pubkey})
        ) AS app_user`,
  )) as unknown as Array<{ app_user: boolean }>;
  if (rows[0]?.app_user) return true;
  return ownListNamesRelay(pubkey);
}

/** The account's newest kind 10002 or 10050 here names one of our URLs. */
async function ownListNamesRelay(pubkey: string): Promise<boolean> {
  const own = ownRelayKeys();
  if (own.size === 0) return false;
  const rows = (await db.execute(
    sql`SELECT DISTINCT ON (kind) kind, tags FROM relay.events
        WHERE pubkey = ${pubkey} AND kind IN (10002, 10050)
        ORDER BY kind, created_at DESC`,
  )) as unknown as Array<{ kind: number; tags: unknown }>;
  return rows.some((r) => Array.isArray(r.tags) && listNamesRelay(r.tags as string[][], own));
}

/** The reported event (by id or coordinate) is stored here, or was removed here. */
export async function targetEventHere(input: Pick<ReportInput, "targetEventId" | "targetCoordinate">): Promise<boolean> {
  if (input.targetEventId && HEX64.test(input.targetEventId)) {
    if (await getRelayEvent(input.targetEventId)) return true;
    if (await getTombstone(input.targetEventId)) return true;
  }
  if (input.targetCoordinate && (await getEventByCoordinate(input.targetCoordinate))) return true;
  return false;
}

/** The account has published anything here besides wraps and reports. */
export async function hasContentHere(pubkey: string | null): Promise<boolean> {
  if (!pubkey || !HEX64.test(pubkey)) return false;
  const rows = (await db.execute(
    sql`SELECT EXISTS (
          SELECT 1 FROM relay.events
          WHERE pubkey = ${pubkey}
            AND kind <> ALL(${sql`ARRAY[${sql.join(NON_CONTENT_KINDS.map((k) => sql`${k}`), sql`, `)}]::int[]`})
        ) AS present`,
  )) as unknown as Array<{ present: boolean }>;
  return rows[0]?.present === true;
}

export async function reportFootprint(input: ReportInput): Promise<ReportFootprint> {
  const [reporterIsAppUser, targetIsAppUser, eventHere, contentHere] = await Promise.all([
    isAppUser(input.reporterPubkey),
    isAppUser(input.targetPubkey),
    targetEventHere(input),
    hasContentHere(input.targetPubkey),
  ]);
  return { reporterIsAppUser, targetIsAppUser, targetEventHere: eventHere, targetHasContentHere: contentHere };
}

/**
 * Classify a report's origin. Only the ingest path (kind 1984 from the own
 * relay) and the CLI backfill call this; an HTTP report is local by its door.
 * A failed lookup keeps the report local: see LOOKUP_FAILED_VERDICT.
 */
export async function classifyOrigin(input: ReportInput): Promise<OriginVerdict> {
  if (input.source !== "nostr") return classifyReportOrigin(input, EMPTY_FOOTPRINT);
  try {
    return classifyReportOrigin(input, await reportFootprint(input));
  } catch (err) {
    console.warn("[reports] origin lookup failed, keeping the report:", (err as Error).message);
    return LOOKUP_FAILED_VERDICT;
  }
}

const EMPTY_FOOTPRINT: ReportFootprint = {
  reporterIsAppUser: false,
  targetIsAppUser: false,
  targetEventHere: false,
  targetHasContentHere: false,
};
