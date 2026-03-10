import { getMeilisearchClient } from "../lib/meilisearch.js";

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
