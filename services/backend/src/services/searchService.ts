import { getMeilisearchClient } from "../lib/meilisearch.js";

/** Sort fields a people query may order by. Allowlisted — never pass user input through. */
const PEOPLE_SORT_FIELDS = new Set(["note_count"]);

export interface PersonHit {
  pubkey: string;
  name?: string;
  display_name?: string;
  nip05?: string;
  about?: string;
  picture?: string;
  has_nip05?: boolean;
  note_count?: number;
}

/**
 * Validate a `field:direction` sort against the allowlist. Unknown fields are
 * dropped rather than rejected — Meilisearch 400s on a non-sortable attribute,
 * and a stale client shouldn't be able to break the browse list.
 */
function normalizePeopleSort(sort: string | undefined): string | undefined {
  if (!sort) return undefined;
  const [field, direction = "desc"] = sort.split(":");
  if (!PEOPLE_SORT_FIELDS.has(field)) return undefined;
  return `${field}:${direction === "asc" ? "asc" : "desc"}`;
}

export const searchService = {
  async search(query: string, opts: { kind?: number; limit?: number }) {
    const client = getMeilisearchClient();
    const index = client.index("events");
    const filters: string[] = [];
    if (opts.kind !== undefined) filters.push(`kind = ${opts.kind}`);

    const results = await index.search(query, {
      limit: opts.limit ?? 20,
      filter: filters.length > 0 ? filters.join(" AND ") : undefined,
    });
    return results.hits;
  },

  /**
   * People search AND people browse.
   *
   * The `q`-less form is the harder, more important one: it backs a default
   * "people worth following" list, so it must produce a *deliberate* ordering
   * rather than whatever the engine happens to return. With no query,
   * `note_count:desc` is applied by default; with a query, relevance leads and
   * an explicit `sort` still wins if given.
   */
  async searchPeople(opts: {
    q?: string;
    hasNip05?: boolean;
    sort?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ people: PersonHit[]; total: number }> {
    const client = getMeilisearchClient();
    const index = client.index("profiles");
    const limit = opts.limit ?? 30;
    const offset = opts.offset ?? 0;
    const query = opts.q?.trim() ?? "";

    const filters: string[] = [];
    if (opts.hasNip05 !== undefined) filters.push(`has_nip05 = ${opts.hasNip05}`);

    // Browsing (no q) always needs an ordering; searching keeps relevance first
    // unless the caller asked for something else.
    const sort = normalizePeopleSort(opts.sort) ?? (query === "" ? "note_count:desc" : undefined);

    const results = await index.search(query, {
      limit,
      offset,
      filter: filters.length > 0 ? filters.join(" AND ") : undefined,
      sort: sort ? [sort] : undefined,
    });

    return {
      people: results.hits as PersonHit[],
      total: results.estimatedTotalHits ?? results.hits.length,
    };
  },

  async searchMusic(
    query: string,
    opts?: { type?: "track" | "album"; limit?: number; genre?: string; hashtag?: string },
  ) {
    const client = getMeilisearchClient();
    const limit = opts?.limit ?? 20;
    const filters: string[] = [];
    if (opts?.genre) filters.push(`genre = "${opts.genre}"`);
    if (opts?.hashtag) filters.push(`hashtags = "${opts.hashtag}"`);
    const filterStr = filters.length > 0 ? filters.join(" AND ") : undefined;

    if (opts?.type === "track") {
      const results = await client.index("tracks").search(query, { limit, filter: filterStr });
      return results.hits;
    }
    if (opts?.type === "album") {
      const results = await client.index("albums").search(query, { limit, filter: filterStr });
      return results.hits;
    }

    // Search both
    const [tracks, albums] = await Promise.all([
      client.index("tracks").search(query, { limit: Math.ceil(limit / 2), filter: filterStr }),
      client.index("albums").search(query, { limit: Math.floor(limit / 2), filter: filterStr }),
    ]);
    return { tracks: tracks.hits, albums: albums.hits };
  },
};
