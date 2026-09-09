import { api } from "./client";

// People discovery over the backend's Meilisearch profiles index
// (services/backend/src/routes/search.ts → GET /search/people). Public.
//
// Two things this endpoint gives us that the client could never compute:
// `has_nip05` as a real filter, and `note_count` as a sortable 30-day activity
// figure. note_count is a 30-DAY window — in a dev database whose newest post
// is older than that, every row legitimately reads 0 and the ordering
// collapses to whatever relevance the index returns. Correct, not broken.

export interface PersonHit {
  pubkey: string;
  /** Best display string the index has; may be null. */
  name: string | null;
  displayName: string | null;
  nip05: string | null;
  about: string | null;
  picture: string | null;
  /** Notes published in the last 30 days. */
  noteCount: number;
  /** Only ever true alongside an actual `nip05` string. */
  hasNip05: boolean;
}

export interface PeopleQuery {
  /** Omit for browse — the endpoint answers a q-less request. */
  q?: string;
  /** Verified handles only. */
  hasNip05?: boolean;
  sort?: string;
  limit?: number;
  offset?: number;
}

function asPerson(raw: unknown): PersonHit | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.pubkey !== "string" || o.pubkey.length === 0) return null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const nip05 = str(o.nip05);
  return {
    pubkey: o.pubkey,
    name: str(o.name),
    displayName: str(o.display_name),
    nip05,
    about: str(o.about),
    picture: str(o.picture),
    noteCount: typeof o.note_count === "number" ? o.note_count : 0,
    // Trust the derived flag, but never claim verified without a handle.
    hasNip05: o.has_nip05 === true && nip05 !== null,
  };
}

/** Parse `{ data: { people, total } }` (or the inner `{people}` object),
 *  degrading to [] on a shape change. */
export function parsePeople(payload: unknown): PersonHit[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data =
    "people" in (payload as object)
      ? payload
      : (payload as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return [];
  const rows = (data as { people?: unknown }).people;
  if (!Array.isArray(rows)) return [];
  return rows.map(asPerson).filter((p): p is PersonHit => p !== null);
}

export async function searchPeople(options: PeopleQuery = {}): Promise<{ data: PersonHit[] }> {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) });
  if (options.q) params.set("q", options.q);
  if (options.hasNip05) params.set("hasNip05", "true");
  if (options.sort) params.set("sort", options.sort);
  if (options.offset) params.set("offset", String(options.offset));
  const res = await api<unknown>(`/search/people?${params}`, { auth: false });
  return { data: parsePeople(res.data) };
}
