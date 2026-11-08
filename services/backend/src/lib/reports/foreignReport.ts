/**
 * Foreign-report classification (pure; the lookups live in
 * services/reportFootprint.ts).
 *
 * Clients publish a kind 1984 to every relay they are connected to, so a
 * public relay collects other people's reports about other people's posts.
 * Those reach the moderation queue through the ingester like any report, yet
 * there is nothing an operator can do about them: the content is not on this
 * relay and the accounts are not this platform's users.
 *
 * A relay-sourced report is FOREIGN when NONE of these hold:
 *  - the reporter is an app user (a name here, a device, a space, an own
 *    relay list naming this relay, or an earlier report through the app);
 *  - the target account is an app user, by the same signals;
 *  - the reported event (or addressable coordinate) is stored here, or was
 *    removed here (a tombstone);
 *  - the target account has any content on this relay.
 *
 * HTTP reports never are: they come through the gateway from the apps. DM and
 * voice reports never are: only the apps produce them, and the wrap / room
 * they name is this platform's.
 */
import type { ReportInput } from "./reportInput.js";

/** What the relay and the app tables say about the two accounts involved. */
export interface ReportFootprint {
  reporterIsAppUser: boolean;
  targetIsAppUser: boolean;
  /** The reported event id / coordinate is stored here (or tombstoned here). */
  targetEventHere: boolean;
  /** The target account has at least one non-wrap, non-report event here. */
  targetHasContentHere: boolean;
}

export type ReportOrigin = "local" | "foreign";

export type OriginSignal =
  | "http_source"
  | "platform_target_type"
  | "reporter_app_user"
  | "target_app_user"
  | "target_event_here"
  | "target_content_here"
  | "lookup_failed";

export type OriginMissing =
  | "reporter_not_app_user"
  | "target_not_app_user"
  | "target_event_absent"
  | "target_content_absent";

/** Resolution string of a report closed as foreign (never a reviewer action). */
export const FOREIGN_RESOLUTION = "foreign";
/** Resolution of a report stored closed because its reporter was over the
 *  open-report cap (config.reportsMaxOpenPerReporter). */
export const REPORTER_LIMIT_RESOLUTION = "reporter_limit";
/** `resolved_by` of a report the system closed at ingest. */
export const SYSTEM_ACTOR = "system";

/** Stored in app.reports.triage as `{ origin, signals }`. */
export interface OriginVerdict {
  origin: ReportOrigin;
  /** Why it stayed local — or, for a foreign report, everything that was missing. */
  signals: Array<OriginSignal | OriginMissing>;
}

/** Target types only the apps produce (the wrap id / room is ours). */
const PLATFORM_TARGET_TYPES: ReadonlySet<ReportInput["targetType"]> = new Set(["dm", "voice"]);

export function classifyReportOrigin(input: ReportInput, fp: ReportFootprint): OriginVerdict {
  if (input.source !== "nostr") return { origin: "local", signals: ["http_source"] };
  if (PLATFORM_TARGET_TYPES.has(input.targetType)) return { origin: "local", signals: ["platform_target_type"] };

  const kept: OriginSignal[] = [];
  if (fp.reporterIsAppUser) kept.push("reporter_app_user");
  if (fp.targetIsAppUser) kept.push("target_app_user");
  if (fp.targetEventHere) kept.push("target_event_here");
  if (fp.targetHasContentHere) kept.push("target_content_here");
  if (kept.length > 0) return { origin: "local", signals: kept };

  return {
    origin: "foreign",
    signals: ["reporter_not_app_user", "target_not_app_user", "target_event_absent", "target_content_absent"],
  };
}

/** When the lookups fail the report stays in the queue: an operator can
 *  always dismiss a foreign one, but a dropped local one is never seen. */
export const LOOKUP_FAILED_VERDICT: OriginVerdict = { origin: "local", signals: ["lookup_failed"] };

/**
 * Relay URLs as the same relay: scheme ignored (ws/wss, http/https), host
 * lowercased, default ports dropped, trailing slashes dropped, userinfo /
 * query / fragment refused. `null` for anything that is not a URL.
 */
export function relayUrlKey(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^(wss?|https?):$/.test(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host) return null;
  const secure = url.protocol === "wss:" || url.protocol === "https:";
  const port = url.port === "" || url.port === (secure ? "443" : "80") ? "" : `:${url.port}`;
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${port}${path}`;
}

/** Does a kind 10002 / 10050 tag list name one of this relay's URLs? */
export function listNamesRelay(tags: string[][], ownKeys: ReadonlySet<string>): boolean {
  if (!Array.isArray(tags) || ownKeys.size === 0) return false;
  for (const tag of tags) {
    if (!Array.isArray(tag) || (tag[0] !== "r" && tag[0] !== "relay")) continue;
    const key = relayUrlKey(tag[1] ?? "");
    if (key && ownKeys.has(key)) return true;
  }
  return false;
}
