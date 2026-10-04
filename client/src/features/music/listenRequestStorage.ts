import type { ListenRequestRecord } from "@/store/slices/musicSlice";

/**
 * The requester's own memory of the listen requests they sent, per account.
 * There is no backend route to read your outgoing requests back, so "you
 * asked, waiting on the artist" lives here. Wrapped so blocked storage never
 * throws into render.
 */

const PREFIX = "wired:listen-requests:";

/** Records older than this are dropped on read — well past the 7-day ask-again
 *  window, so a forgotten request just becomes askable again. */
export const LISTEN_REQUEST_RECORD_TTL_SEC = 60 * 24 * 60 * 60;

export function listenRequestStorageKey(pubkey: string): string {
  return `${PREFIX}${pubkey}`;
}

/** Defensive parse of the stored map; expired and malformed entries are dropped. */
export function parseStoredListenRequests(
  raw: unknown,
  nowSec: number = Math.floor(Date.now() / 1000),
): Record<string, ListenRequestRecord> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, ListenRequestRecord> = {};
  for (const [ref, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const r = value as Record<string, unknown>;
    if (typeof r.requestedAt !== "number" || !Number.isFinite(r.requestedAt)) continue;
    if (typeof r.eventId !== "string") continue;
    if (nowSec - r.requestedAt > LISTEN_REQUEST_RECORD_TTL_SEC) continue;
    out[ref] = { requestedAt: r.requestedAt, eventId: r.eventId };
  }
  return out;
}

export function readListenRequests(pubkey: string): Record<string, ListenRequestRecord> {
  try {
    const raw = localStorage.getItem(listenRequestStorageKey(pubkey));
    return raw ? parseStoredListenRequests(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeListenRequests(pubkey: string, records: Record<string, ListenRequestRecord>): void {
  try {
    localStorage.setItem(listenRequestStorageKey(pubkey), JSON.stringify(records));
  } catch {
    // Storage blocked — the request is still out; we just won't remember it.
  }
}
