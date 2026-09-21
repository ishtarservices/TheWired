// The kind-30078 `thewired:dm_read_state` record (docs/DM_WIRE_CONTRACT.md §6):
// per-conversation read cursors plus pin / archive / mute / disappearing
// timer, NIP-44-encrypted to self, MERGED never overwritten.
//
// Merge rules (per conversation key):
//  - lastRead: max.
//  - pinned / archived / muted: a "flag stamp" — positive = set at that unix
//    time, negative = removed (tombstone) at |value|. The larger |value| wins;
//    on a tie the positive (set) wins. Tombstones older than TOMBSTONE_TTL are
//    dropped on encode so the record doesn't grow forever.
//  - expireAfter: { s, at } — larger `at` wins.

import type {
  DMExpireAfter,
  DMFlagStamp,
  DMReadStateRecord,
  DMReadStateRecordV2,
} from "@ishtarservices/shared-types";
import { DM_READ_STATE_D_TAG as D_TAG } from "@ishtarservices/shared-types";
import type { Nip44Codec } from "../crypto/nip44";

export const DM_READ_STATE_D_TAG = D_TAG;
export const TOMBSTONE_TTL_SECONDS = 30 * 24 * 3600;
/** `muted[id] = MUTED_FOREVER` mutes with no end. */
export const MUTED_FOREVER = 4102444800; // 2100-01-01

export type DMFlagField = "pinned" | "archived" | "muted";

export function emptyDMReadState(): DMReadStateRecordV2 {
  return { v: 2, lastRead: {}, pinned: {}, archived: {}, muted: {}, expireAfter: {}, updatedAt: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "number" && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

function expireMap(v: unknown): Record<string, DMExpireAfter> {
  const out: Record<string, DMExpireAfter> = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (
      isRecord(val) &&
      typeof val.s === "number" &&
      Number.isFinite(val.s) &&
      typeof val.at === "number" &&
      Number.isFinite(val.at)
    ) {
      out[k] = { s: Math.max(0, Math.floor(val.s)), at: Math.floor(val.at) };
    }
  }
  return out;
}

/** Accept v1 (`{lastRead}`), v2, or garbage → always a well-formed v2. */
export function normalizeDMReadState(input: unknown): DMReadStateRecordV2 {
  const rec = emptyDMReadState();
  if (!isRecord(input)) return rec;
  rec.lastRead = numberMap(input.lastRead);
  if (input.v === 2) {
    rec.pinned = numberMap(input.pinned);
    rec.archived = numberMap(input.archived);
    rec.muted = numberMap(input.muted);
    rec.expireAfter = expireMap(input.expireAfter);
    rec.updatedAt = typeof input.updatedAt === "number" ? input.updatedAt : 0;
  }
  return rec;
}

function mergeFlags(
  a: Record<string, DMFlagStamp>,
  b: Record<string, DMFlagStamp>,
): Record<string, DMFlagStamp> {
  const out: Record<string, DMFlagStamp> = { ...a };
  for (const [k, vb] of Object.entries(b)) {
    const va = out[k];
    if (va === undefined) {
      out[k] = vb;
      continue;
    }
    const ta = Math.abs(va);
    const tb = Math.abs(vb);
    if (tb > ta) out[k] = vb;
    else if (tb === ta && vb > 0 && va < 0) out[k] = vb;
  }
  return out;
}

/** Commutative, idempotent merge of two records. */
export function mergeDMReadState(a: DMReadStateRecord | null | undefined, b: DMReadStateRecord | null | undefined): DMReadStateRecordV2 {
  const A = normalizeDMReadState(a);
  const B = normalizeDMReadState(b);
  const out = emptyDMReadState();
  out.lastRead = { ...A.lastRead };
  for (const [k, v] of Object.entries(B.lastRead)) {
    out.lastRead[k] = Math.max(out.lastRead[k] ?? 0, v);
  }
  out.pinned = mergeFlags(A.pinned, B.pinned);
  out.archived = mergeFlags(A.archived, B.archived);
  out.muted = mergeFlags(A.muted, B.muted);
  out.expireAfter = { ...A.expireAfter };
  for (const [k, v] of Object.entries(B.expireAfter)) {
    const cur = out.expireAfter[k];
    if (!cur || v.at > cur.at) out.expireAfter[k] = v;
  }
  out.updatedAt = Math.max(A.updatedAt, B.updatedAt);
  return out;
}

/** Whether a flag is currently set (positive stamp; `muted` also honours an
 *  "until" in the future). */
export function isDMFlagSet(
  rec: DMReadStateRecordV2,
  field: DMFlagField,
  conversationId: string,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  const v = rec[field][conversationId];
  if (v === undefined || v <= 0) return false;
  if (field === "muted") return v > now;
  return true;
}

/** Return a NEW record with `field[conversationId]` set or removed. For
 *  `muted`, pass `until` (unix seconds, or MUTED_FOREVER); for the others the
 *  stamp is `now`. */
export function setDMFlag(
  rec: DMReadStateRecordV2,
  field: DMFlagField,
  conversationId: string,
  on: boolean,
  opts: { now?: number; until?: number } = {},
): DMReadStateRecordV2 {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const next: DMReadStateRecordV2 = { ...rec, [field]: { ...rec[field] }, updatedAt: now };
  if (on) {
    const stamp = field === "muted" ? Math.max(opts.until ?? MUTED_FOREVER, now + 1) : now;
    // A set must out-rank an existing tombstone from the same second.
    const prev = rec[field][conversationId];
    next[field][conversationId] = prev !== undefined && Math.abs(prev) >= stamp ? Math.abs(prev) + 1 : stamp;
  } else {
    const prev = rec[field][conversationId];
    const t = prev !== undefined && Math.abs(prev) >= now ? Math.abs(prev) + 1 : now;
    next[field][conversationId] = -t;
  }
  return next;
}

export function setDMExpireAfter(
  rec: DMReadStateRecordV2,
  conversationId: string,
  seconds: number,
  now: number = Math.floor(Date.now() / 1000),
): DMReadStateRecordV2 {
  const prev = rec.expireAfter[conversationId];
  const at = prev && prev.at >= now ? prev.at + 1 : now;
  return {
    ...rec,
    expireAfter: { ...rec.expireAfter, [conversationId]: { s: Math.max(0, Math.floor(seconds)), at } },
    updatedAt: now,
  };
}

export function setDMLastRead(
  rec: DMReadStateRecordV2,
  conversationId: string,
  ts: number,
): DMReadStateRecordV2 {
  const cur = rec.lastRead[conversationId] ?? 0;
  if (ts <= cur) return rec;
  return { ...rec, lastRead: { ...rec.lastRead, [conversationId]: ts }, updatedAt: Math.max(rec.updatedAt, ts) };
}

/** Drop old tombstones and zero-timers before publishing. */
export function compactDMReadState(
  rec: DMReadStateRecordV2,
  now: number = Math.floor(Date.now() / 1000),
): DMReadStateRecordV2 {
  const prune = (m: Record<string, DMFlagStamp>) =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0 || now - Math.abs(v) < TOMBSTONE_TTL_SECONDS));
  return {
    ...rec,
    pinned: prune(rec.pinned),
    archived: prune(rec.archived),
    muted: prune(rec.muted),
    expireAfter: Object.fromEntries(
      Object.entries(rec.expireAfter).filter(([, v]) => v.s > 0 || now - v.at < TOMBSTONE_TTL_SECONDS),
    ),
  };
}

/** Encrypt a record to self for the kind-30078 content. */
export async function encodeDMReadState(
  codec: Pick<Nip44Codec, "nip44Encrypt">,
  myPubkey: string,
  rec: DMReadStateRecordV2,
): Promise<string> {
  return codec.nip44Encrypt(myPubkey, JSON.stringify(compactDMReadState(rec)));
}

/** Decrypt + normalize a kind-30078 content; null on any failure. */
export async function decodeDMReadState(
  codec: Pick<Nip44Codec, "nip44Decrypt">,
  myPubkey: string,
  content: string,
): Promise<DMReadStateRecordV2 | null> {
  try {
    const plaintext = await codec.nip44Decrypt(myPubkey, content);
    return normalizeDMReadState(JSON.parse(plaintext));
  } catch {
    return null;
  }
}
