/**
 * Shared visibility policy for music events (kinds 31683/33123/30119) resolved
 * over REST. One policy, three consumers: the /music/resolve/* routes, the
 * /music/access token minting, and the /music/insights gate. The blob/HLS layer
 * enforces the same model via services/blobAccess.ts. Full matrix:
 * docs/MUSIC_VISIBILITY.md.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaceMembers } from "../db/schema/members.js";
import { pTagGrantsAccess } from "./blobAccess.js";

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
 * Pure visibility policy: may `authPubkey` see this event? Space-scoped (`h`)
 * requires ownership or membership of ANY listed space (a multi-space event
 * carries one `h` tag per space); private/unlisted requires ownership or an
 * access-granting p-tag (role "artist"/"collaborator" or role-less — a
 * "featured" credit is NOT an access grant; see blobAccess.pTagGrantsAccess).
 * `membershipCache` dedupes space-membership queries across a batch of events,
 * keyed `${spaceId}:${pubkey}`.
 */
export async function isEventVisibleTo(
  event: RelayEvent,
  ownerPubkey: string,
  authPubkey: string | null,
  membershipCache?: Map<string, boolean>,
): Promise<boolean> {
  const eventTags = event.tags;
  const vis = eventTags.find((t: string[]) => t[0] === "visibility")?.[1];
  const hTags = [...new Set(eventTags.filter((t) => t[0] === "h" && t[1]).map((t) => t[1]))];

  // Space-scoped: require ownership or membership of ANY listed space
  if (hTags.length > 0) {
    if (!authPubkey) return false;
    if (authPubkey !== ownerPubkey) {
      if (!(await isMemberOfAny(hTags, authPubkey, membershipCache))) return false;
    }
  }

  // Private/unlisted: require ownership or an access-granting p-tag
  if (vis === "unlisted" || vis === "private") {
    if (!authPubkey) return false;
    if (authPubkey !== ownerPubkey && !eventTags.some((t) => pTagGrantsAccess(t, authPubkey))) {
      return false;
    }
  }

  return true;
}

/**
 * Is `authPubkey` a member of at least one of `spaceIds`? Consults the cache
 * per space, queries every uncached id in one `IN (...)` select, and fills the
 * cache for each id (true for the hits, false for the rest) so a batch of
 * events sharing spaces costs one round trip.
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

  const rows = await db
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(and(inArray(spaceMembers.spaceId, uncached), eq(spaceMembers.pubkey, authPubkey)));
  const memberOf = new Set(rows.map((r) => r.spaceId));
  for (const spaceId of uncached) {
    membershipCache?.set(`${spaceId}:${authPubkey}`, memberOf.has(spaceId));
  }
  return memberOf.size > 0;
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
