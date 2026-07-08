// Space feed-channel routing — a port of the desktop SPACE_CHANNEL_ROUTES
// (client/src/features/spaces/spaceChannelRoutes.ts) for the authors-mode
// channel types. Chat stays h-tag/kind-9 on the host relay (chatSession);
// these four aggregate MEMBERS' content, which lives on the members' own
// relays — so they query the engine's read set, not the hostRelay.

import type { NostrFilter } from "@thewired/shared-types";

export type SpaceFeedType = "notes" | "media" | "articles" | "music";

export interface SpaceFeedRoute {
  kinds: number[];
  pageSize: number;
}

export const SPACE_FEED_ROUTES: Record<SpaceFeedType, SpaceFeedRoute> = {
  // Short text + polls
  notes: { kinds: [1, 1068], pageSize: 30 },
  // Pictures + horizontal/vertical video (event + addressable forms)
  media: { kinds: [20, 21, 22, 34235, 34236], pageSize: 24 },
  // Long-form
  articles: { kinds: [30023], pageSize: 10 },
  // Tracks + albums
  music: { kinds: [31683, 33123], pageSize: 30 },
};

export function isSpaceFeedType(type: string): type is SpaceFeedType {
  return type in SPACE_FEED_ROUTES;
}

/** Desktop parity: relays reject huge filters; chunk instead of capping. */
export const AUTHORS_CHUNK = 500;

/**
 * Whose content fills a feed channel:
 * - curated channels and read-only ("feed") spaces show the curated
 *   feed-sources (falling back to members when none are set);
 * - community channels show members plus any feed-sources.
 */
export function selectFeedAuthors(options: {
  members: string[];
  feedSources: string[];
  curated: boolean;
}): string[] {
  const { members, feedSources, curated } = options;
  if (curated) return feedSources.length > 0 ? [...new Set(feedSources)] : [...new Set(members)];
  return [...new Set([...members, ...feedSources])];
}

/** One filter per ≤500-author chunk; pass the array to engine.fetchEvents. */
export function buildSpaceFeedFilters(
  type: SpaceFeedType,
  authors: string[],
  until?: number,
): NostrFilter[] {
  if (authors.length === 0) return [];
  const route = SPACE_FEED_ROUTES[type];
  const filters: NostrFilter[] = [];
  for (let i = 0; i < authors.length; i += AUTHORS_CHUNK) {
    const filter: NostrFilter = {
      kinds: route.kinds,
      authors: authors.slice(i, i + AUTHORS_CHUNK),
      limit: route.pageSize,
    };
    if (until !== undefined) filter.until = until;
    filters.push(filter);
  }
  return filters;
}
