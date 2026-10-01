/**
 * Report intake normalisation — PURE. Both doors (a kind-1984 event ingested
 * from the platform relay, and `POST /reports`) end up as one `ReportInput`,
 * so validation and target classification live in exactly one place.
 *
 * Wire format (NIP-56, as the soot mobile client publishes it):
 *   ["p", <reported pubkey>, <nip56 type>]        when the account is known
 *   ["e", <event id>, <nip56 type>]               event targets
 *   ["a", "<kind>:<pubkey>:<d>", <nip56 type>]    addressable kinds only
 *   ["k", "<event kind>"]                         event targets
 *   ["wrap", <gift wrap id>]                      dm targets (no e tag)
 *   ["room", <roomId>] ["space", <spaceId>]       voice targets, if known
 *   ["L", "app.soot.report"]        ["l", <category>, "app.soot.report"]
 *   ["L", "app.soot.report.target"] ["l", event|user|dm|voice, "app.soot.report.target"]
 *   content = the reporter's optional note (never the reported text)
 *
 * Triage keys on the `l` category, not the NIP-56 type: harassment and
 * copyright both travel as NIP-56 "other". A plain NIP-56 report from another
 * client (no `l` tags) is still accepted, its category mapped from the type.
 */
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportSource,
  type ReportTargetContext,
  type ReportTargetType,
} from "../../db/schema/reports.js";

export const KIND_REPORT = 1984;
export const REPORT_LABEL_NAMESPACE = "app.soot.report";
export const REPORT_TARGET_NAMESPACE = "app.soot.report.target";
export const REPORT_NOTE_MAX = 500;
const CONTEXT_ID_MAX = 128;

const KIND_TRACK = 31683;
const KIND_ALBUM = 33123;

export interface ReportInput {
  source: ReportSource;
  reporterPubkey: string | null;
  reporterIpHash: string | null;
  targetType: ReportTargetType;
  targetEventId: string | null;
  targetCoordinate: string | null;
  targetPubkey: string | null;
  targetKind: number | null;
  targetContext: ReportTargetContext | null;
  category: ReportCategory;
  note: string | null;
  reportEventId: string | null;
}

/** The ids a report may carry, whichever door it came through. */
export interface RawReportTarget {
  target: string;
  category: string;
  note?: string | null;
  pubkey?: string | null;
  eventId?: string | null;
  eventKind?: number | null;
  coordinate?: string | null;
  wrapId?: string | null;
  roomId?: string | null;
  spaceId?: string | null;
}

interface ReportEventLike {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
}

const HEX64 = /^[0-9a-f]{64}$/;
const COORDINATE = /^(\d{1,5}):([0-9a-f]{64}):(.{0,256})$/s;

export function isHex64(v: unknown): v is string {
  return typeof v === "string" && HEX64.test(v);
}

/** `kind:pubkey:d` → its parts, or null when malformed / not addressable. */
export function parseCoordinate(v: string): { kind: number; pubkey: string; d: string } | null {
  const m = COORDINATE.exec(v);
  if (!m) return null;
  const kind = Number(m[1]);
  if (kind < 30000 || kind >= 40000) return null;
  return { kind, pubkey: m[2], d: m[3] };
}

/** NIP-56's closed vocabulary → our categories, for reports without an `l`. */
const NIP56_TO_CATEGORY: Record<string, ReportCategory> = {
  spam: "spam",
  nudity: "nudity",
  illegal: "illegal",
  impersonation: "impersonation",
  malware: "malware",
  profanity: "harassment",
  other: "other",
};

export function normalizeCategory(v: string | undefined | null): ReportCategory {
  const c = (v ?? "").trim().toLowerCase();
  return (REPORT_CATEGORIES as readonly string[]).includes(c) ? (c as ReportCategory) : "other";
}

export function capNote(note: string | null | undefined): string | null {
  const n = (note ?? "").trim().slice(0, REPORT_NOTE_MAX);
  return n.length > 0 ? n : null;
}

function contextId(v: string | null | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 && t.length <= CONTEXT_ID_MAX ? t : undefined;
}

/**
 * Validate the ids for a target and classify it. Returns null when the report
 * does not identify anything (it is dropped / answered 400). An event target
 * of a music kind is filed as `track` / `album` so the reviewer sees what
 * `remove_music` would act on.
 */
export function normalizeTarget(
  raw: RawReportTarget,
): Pick<
  ReportInput,
  "targetType" | "targetEventId" | "targetCoordinate" | "targetPubkey" | "targetKind" | "targetContext"
> | null {
  const pubkey = isHex64(raw.pubkey) ? raw.pubkey : null;
  const eventId = isHex64(raw.eventId) ? raw.eventId : null;
  const coord = typeof raw.coordinate === "string" ? parseCoordinate(raw.coordinate) : null;
  const coordinate = coord ? raw.coordinate! : null;
  let kind =
    typeof raw.eventKind === "number" && Number.isInteger(raw.eventKind) && raw.eventKind >= 0 && raw.eventKind < 65536
      ? raw.eventKind
      : null;
  if (kind === null && coord) kind = coord.kind;

  switch (raw.target) {
    case "event":
    case "track":
    case "album": {
      if (!eventId && !coordinate) return null;
      let type: ReportTargetType = "event";
      if (raw.target === "track" || kind === KIND_TRACK) type = "track";
      else if (raw.target === "album" || kind === KIND_ALBUM) type = "album";
      return {
        targetType: type,
        targetEventId: eventId,
        targetCoordinate: coordinate,
        // The coordinate names its author even when the client did not.
        targetPubkey: pubkey ?? coord?.pubkey ?? null,
        targetKind: kind,
        targetContext: null,
      };
    }
    case "user":
      if (!pubkey) return null;
      return {
        targetType: "user",
        targetEventId: null,
        targetCoordinate: null,
        targetPubkey: pubkey,
        targetKind: null,
        targetContext: null,
      };
    case "dm": {
      // A DM report can only name the wrap: the operator cannot open it, so
      // it is judged on the pattern (several reporters, account age).
      const wrapId = isHex64(raw.wrapId) ? raw.wrapId : null;
      if (!wrapId) return null;
      return {
        targetType: "dm",
        targetEventId: wrapId,
        targetCoordinate: null,
        targetPubkey: pubkey,
        targetKind: 1059,
        targetContext: null,
      };
    }
    case "voice": {
      const roomId = contextId(raw.roomId);
      const spaceId = contextId(raw.spaceId);
      if (!pubkey && !roomId && !spaceId) return null;
      const context: ReportTargetContext = {};
      if (roomId) context.roomId = roomId;
      if (spaceId) context.spaceId = spaceId;
      return {
        targetType: "voice",
        targetEventId: null,
        targetCoordinate: null,
        targetPubkey: pubkey,
        targetKind: null,
        targetContext: roomId || spaceId ? context : null,
      };
    }
    default:
      return null;
  }
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

function labelIn(tags: string[][], namespace: string): string | undefined {
  return tags.find((t) => t[0] === "l" && t[2] === namespace)?.[1];
}

/** A kind-1984 event (already signature-verified) → ReportInput, or null. */
export function parseReportEvent(event: ReportEventLike): ReportInput | null {
  if (event.kind !== KIND_REPORT || !isHex64(event.pubkey)) return null;
  const tags = event.tags;
  const p = tags.find((t) => t[0] === "p");
  const e = tags.find((t) => t[0] === "e");
  const a = tags.find((t) => t[0] === "a");
  const k = tagValue(tags, "k");

  const labelled = labelIn(tags, REPORT_LABEL_NAMESPACE);
  const category = labelled
    ? normalizeCategory(labelled)
    : (NIP56_TO_CATEGORY[(e?.[2] ?? p?.[2] ?? "").toLowerCase()] ?? "other");

  // Target type: the label when present, else what the tags identify.
  const target =
    labelIn(tags, REPORT_TARGET_NAMESPACE) ?? (e || a ? "event" : tagValue(tags, "wrap") ? "dm" : "user");

  const normalized = normalizeTarget({
    target,
    category,
    pubkey: p?.[1],
    eventId: e?.[1],
    eventKind: k !== undefined && /^\d{1,5}$/.test(k) ? Number(k) : null,
    coordinate: a?.[1],
    wrapId: tagValue(tags, "wrap"),
    roomId: tagValue(tags, "room"),
    spaceId: tagValue(tags, "space"),
  });
  if (!normalized) return null;
  // Reporting yourself is noise, never a signal.
  if (normalized.targetPubkey === event.pubkey && normalized.targetType === "user") return null;

  return {
    source: "nostr",
    reporterPubkey: event.pubkey,
    reporterIpHash: null,
    ...normalized,
    category,
    note: capNote(event.content),
    reportEventId: event.id,
  };
}
