/**
 * Catalog listing for music events (kind 31683 tracks). Pure — no DB, no
 * Meilisearch — so both `lib/` (search-doc builder) and `services/` can share
 * the single predicate. Contract: docs/MUSIC_VISIBILITY.md §"Catalog listing".
 *
 * `["catalog","none"]` marks a real, playable, public track its author keeps
 * OFF their catalog (mobile "audio attached to a note"). It is NOT a visibility
 * state and never gates reads: resolve, access tokens, HLS, blobs, insights,
 * proposals and the OG track page all serve it unchanged. Only public
 * discovery surfaces (browse, trending, search, listed-space music, the OG
 * catalog page, genre/tag counts) and author-catalog shelves exclude it.
 *
 * Unrelated to the legacy `["visibility","unlisted"]` state, which the servers
 * treat as private (and desktop's parseVisibility maps to private).
 */

export const CATALOG_TAG = "catalog";

/** Does the event carry `["catalog","none"]`? Any other value (or no tag) = listed. */
export function isUnlisted(tags: string[][]): boolean {
  return tags.some((t) => t[0] === CATALOG_TAG && t[1] === "none");
}

/**
 * A shared-project `moved` stub (soot docs/collab-shared-key.md): what a key
 * rotation or a personal→shared conversion leaves at the old address, pointing
 * at the new one. It keeps the release's title but has no audio; clients never
 * shelve, list or play it, so neither do discovery surfaces.
 */
export function isMovedStub(tags: string[][]): boolean {
  return tags.some((t) => t[0] === "moved" && !!t[1]);
}

/**
 * No `visibility` tag, no `h` tag, no `["catalog","none"]`, not a moved stub —
 * the bar for every public discovery surface. Use this instead of re-deriving
 * `!vis && !hTag`.
 */
export function isListedPublicMusic(tags: string[][]): boolean {
  return (
    !tags.some((t) => t[0] === "visibility" || t[0] === "h") && !isUnlisted(tags) && !isMovedStub(tags)
  );
}

/**
 * Does this version belong in the tracks/albums search index? Public (no
 * valued `visibility` or `h` tag, the same protected shape the relay and
 * musicVisibility read) and not a moved stub. `catalog:none` tracks DO belong:
 * they are indexed with `unlisted: true` and filtered at query time.
 */
export function isIndexableMusic(tags: string[][]): boolean {
  return !tags.some((t) => (t[0] === "visibility" || t[0] === "h") && !!t[1]) && !isMovedStub(tags);
}

/**
 * Meilisearch filter clause that keeps only listed docs. Unlisted docs carry
 * `unlisted: true`; listed docs carry `unlisted: false` or (legacy, indexed
 * before the field existed) no attribute at all. Verified on Meilisearch
 * 1.6.2: `NOT unlisted = true` matches documents that lack the attribute, so
 * a deploy does not blank browse/search while the index is backfilled.
 */
export const MS_LISTED_FILTER = "NOT unlisted = true";

/** SQL fragment (relay.events.tags JSONB) excluding `["catalog","none"]`; the GIN index on tags covers `@>`. */
export const SQL_NOT_UNLISTED = `NOT (tags @> '[["catalog","none"]]'::jsonb)`;
