/**
 * Shared visibility policy for music events (kinds 31683/33123/30119) resolved
 * over REST. One policy, three consumers: the /music/resolve/* routes, the
 * /music/access token minting, and the /music/insights gate. The blob/HLS layer
 * enforces the same model via services/blobAccess.ts. Full matrix:
 * docs/MUSIC_VISIBILITY.md.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { pTagGrantsAccess } from "./blobAccess.js";
import { isListedPublicMusic } from "../lib/musicListing.js";
import { suspensionService } from "./suspensionService.js";

// Catalog-listing predicate lives in lib/ (pure) so the search-doc builder can
// share it; re-exported here because this module is the visibility policy's
// public face. See docs/MUSIC_VISIBILITY.md §"Catalog listing".
export { CATALOG_TAG, isUnlisted, isListedPublicMusic } from "../lib/musicListing.js";

export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number | string;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** Normalize PG bigint fields to JS numbers for JSON serialization */
export function normalizeEvent(row: RelayEvent): RelayEvent {
  return { ...row, created_at: Number(row.created_at) };
}

/**
 * Pure visibility policy: may `authPubkey` see this event? The author and any
 * pubkey with an access-granting p-tag (role "artist", a member role
 * "collaborator" / "contributor" / "editor", or role-less; a "featured" credit
 * is NOT a grant — see blobAccess.pTagGrantsAccess, the single source of truth)
 * may always see it. Beyond those, space-scoped (`h`) content is visible to a
 * member of ANY listed space (a multi-space event carries one `h` tag per
 * space); private/unlisted content is visible to nobody else. Anonymous
 * viewers never see non-public content. This is the same order the blob layer
 * applies (blobAccess.authorizeProtectedRef), so a p-tag grantee of a
 * space-scoped release resolves it, mints a token, and fetches its media alike.
 * `membershipCache` dedupes space-membership queries across a batch of events,
 * keyed `${spaceId}:${pubkey}`.
 */
export async function isEventVisibleTo(
  event: RelayEvent,
  ownerPubkey: string,
  authPubkey: string | null,
  membershipCache?: Map<string, boolean>,
): Promise<boolean> {
  // A suspended account's music is hidden from everyone but its author
  // (suspend_pubkey, App Store 1.2 — reversible, so nothing is deleted).
  if (authPubkey !== event.pubkey && (await suspensionService.isSuspended(event.pubkey))) return false;

  const eventTags = event.tags;
  const hTags = [...new Set(eventTags.filter((t) => t[0] === "h" && t[1]).map((t) => t[1]))];
  const hasVisibility = hasProtectedVisibility(eventTags);

  const isProtected = hTags.length > 0 || hasVisibility;
  if (!isProtected) return true;
  if (!authPubkey) return false;

  // The author and access-granting p-tags see every protected shape.
  if (authPubkey === ownerPubkey) return true;
  if (eventTags.some((t) => pTagGrantsAccess(t, authPubkey))) return true;

  // Private/unlisted admits nobody else (an `h` tag on a private event does
  // not widen it to the space).
  if (hasVisibility) return false;

  // Space-scoped: membership of ANY listed space.
  return isMemberOfAny(hTags, authPubkey, membershipCache);
}

/**
 * Does the event carry a protecting `visibility` tag? ANY valued visibility
 * tag protects (private, unlisted, or an unknown future value) — the relay's
 * `visibility` column is populated the same way, so an unknown value hides
 * rather than exposes on every layer.
 */
export function hasProtectedVisibility(tags: string[][]): boolean {
  return tags.some((t) => t[0] === "visibility" && !!t[1]);
}

/**
 * Is `authPubkey` a member of at least one of `spaceIds`? Consults the cache
 * per space, queries every uncached id in one select, and fills the cache for
 * each id (true for the hits, false for the rest) so a batch of events sharing
 * spaces costs one round trip.
 */
async function isMemberOfAny(
  spaceIds: string[],
  authPubkey: string,
  membershipCache?: Map<string, boolean>,
): Promise<boolean> {
  const uncached: string[] = [];
  for (const spaceId of spaceIds) {
    const cached = membershipCache?.get(`${spaceId}:${authPubkey}`);
    if (cached === true) return true;
    if (cached === undefined) uncached.push(spaceId);
  }
  if (uncached.length === 0) return false;

  const memberOf = await spacesMemberOf(uncached, authPubkey);
  for (const spaceId of uncached) {
    membershipCache?.set(`${spaceId}:${authPubkey}`, memberOf.has(spaceId));
  }
  return memberOf.size > 0;
}

/**
 * Which of `spaceIds` is `pubkey` a member of — in EITHER membership world the
 * relay honours (services/relay/src/db/membership_source.rs): the backend's
 * `app.space_members` (Platform / A-lite spaces) or the relay-native
 * `relay.group_members` (NIP-29-native groups hosted on this relay). Without
 * the union a native-group member could read a track over the relay but get a
 * 404 from every backend surface for it.
 */
export async function spacesMemberOf(spaceIds: string[], pubkey: string): Promise<Set<string>> {
  if (spaceIds.length === 0) return new Set();
  const ids = sql.join(spaceIds.map((id) => sql`${id}`), sql`, `);
  const rows = (await db.execute(
    sql`SELECT space_id FROM app.space_members WHERE pubkey = ${pubkey} AND space_id IN (${ids})
        UNION
        SELECT group_id FROM relay.group_members WHERE pubkey = ${pubkey} AND group_id IN (${ids})`,
  )) as unknown as Array<{ space_id: string }>;
  return new Set(rows.map((r) => r.space_id));
}

/** Enforce visibility on a top-level resolve target. Writes a 404 to `reply` and
 *  returns false when denied. */
export async function checkEventVisibility(
  event: RelayEvent,
  ownerPubkey: string,
  authPubkey: string | null,
  reply: import("fastify").FastifyReply,
): Promise<boolean> {
  const allowed = await isEventVisibleTo(event, ownerPubkey, authPubkey);
  if (!allowed) {
    reply.status(404).send({ error: "Not found", code: "NOT_FOUND" });
  }
  return allowed;
}

/** Fetch the latest event for an addressable id (`kind:pubkey:d`), or null. */
export async function fetchLatestByAddressableId(
  addressableId: string,
): Promise<RelayEvent | null> {
  const [kindStr, pubkey, ...dParts] = addressableId.split(":");
  const dTag = dParts.join(":");
  const kind = parseInt(kindStr, 10);
  if (!Number.isInteger(kind) || !pubkey || !dTag) return null;

  const rows = (await db.execute(
    sql`SELECT id, pubkey, created_at, kind, tags, content, sig
        FROM relay.events
        WHERE kind = ${kind}
          AND pubkey = ${pubkey}
          AND tags @> ${JSON.stringify([["d", dTag]])}::jsonb
        ORDER BY created_at DESC
        LIMIT 1`,
  )) as unknown as RelayEvent[];
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Batch-resolve the latest kind-31683 track event per `31683:pubkey:d` ref and
 * filter to what `authPubkey` may see. Result preserves `refs` order. One query
 * for all children (DISTINCT ON the addressable identity) instead of one per ref.
 */
export async function resolveVisibleChildTracks(
  refs: string[],
  authPubkey: string | null,
): Promise<RelayEvent[]> {
  const pairs: Array<[string, string]> = [];
  for (const ref of refs) {
    const [, tPubkey, ...dParts] = ref.split(":");
    const dTag = dParts.join(":");
    if (tPubkey && dTag) pairs.push([tPubkey, dTag]);
  }
  if (pairs.length === 0) return [];

  const tuples = sql.join(
    pairs.map(([p, d]) => sql`(${p}, ${d})`),
    sql`, `,
  );
  const rows = (await db.execute(
    sql`SELECT DISTINCT ON (pubkey, d_tag)
          id, pubkey, created_at, kind, tags, content, sig, d_tag
        FROM relay.events
        WHERE kind = 31683 AND (pubkey, d_tag) IN (${tuples})
        ORDER BY pubkey, d_tag, created_at DESC`,
  )) as unknown as Array<RelayEvent & { d_tag: string }>;

  const byAddr = new Map(rows.map((r) => [`${r.pubkey}:${r.d_tag}`, r]));
  const membershipCache = new Map<string, boolean>();
  const visible: RelayEvent[] = [];
  for (const [p, d] of pairs) {
    const row = byAddr.get(`${p}:${d}`);
    if (!row) continue;
    if (await isEventVisibleTo(row, row.pubkey, authPubkey, membershipCache)) {
      const { d_tag: _dTag, ...event } = row;
      visible.push(normalizeEvent(event));
    }
  }
  return visible;
}

/**
 * An artist's PUBLIC, LISTED catalog — latest event per (kind, d-tag) for
 * tracks (31683) and albums (33123), newest first. Private/unlisted and
 * space-scoped rows are excluded at the SQL layer (the indexed columns), as are
 * `["catalog","none"]` tracks (JSONB containment; a note-only clip is not part
 * of the author's discography), and every row is re-checked on the tags with
 * isListedPublicMusic so the share page can never leak a title it shouldn't.
 * Feeds the server-rendered /profile/:pubkey?section=music share page.
 */
export async function fetchPublicCatalogByPubkey(
  pubkey: string,
  limit = 100,
): Promise<RelayEvent[]> {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return [];
  const rows = (await db.execute(
    sql`SELECT id, pubkey, created_at, kind, tags, content, sig
        FROM (
          SELECT DISTINCT ON (kind, d_tag)
            id, pubkey, created_at, kind, tags, content, sig
          FROM relay.events
          WHERE pubkey = ${pubkey}
            AND kind IN (31683, 33123)
            AND visibility IS NULL
            AND h_tag IS NULL
            AND NOT (tags @> '[["catalog","none"]]'::jsonb)
          ORDER BY kind, d_tag, created_at DESC
        ) latest
        ORDER BY created_at DESC
        LIMIT ${limit}`,
  )) as unknown as RelayEvent[];
  return rows.filter((row) => isListedPublicMusic(row.tags)).map(normalizeEvent);
}
