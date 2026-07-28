/**
 * Shared access control for protected (private/unlisted/space) music blobs.
 *
 * A blob is "protected" when it is referenced by a kind 31683/33123 event that
 * carries a `visibility` (private/unlisted) or `h` (space) tag. Both the raw-blob
 * route (routes/blossom.ts) and the HLS route (routes/hls.ts) consult this module
 * to decide whether an untokened request may be served. Results are cached briefly
 * so the HLS hot path doesn't re-query on every segment.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaceMembers } from "../db/schema/members.js";

export interface ProtectedEventRef {
  pubkey: string;
  tags: string[][];
}

interface CacheEntry {
  ref: ProtectedEventRef | null;
  at: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 2000;
const cache = new Map<string, CacheEntry>();

/** Confirm the sha actually appears in a blob-bearing tag (imeta/x/url/image/thumb),
 *  not just anywhere in the serialized tags — guards the LIKE query's false positives. */
function blobShaInTags(tags: string[][], sha256: string): boolean {
  for (const t of tags) {
    if (t[0] === "x" && t[1] === sha256) return true;
    if (t[0] === "imeta" && t.some((v) => typeof v === "string" && v.includes(sha256))) return true;
    if (
      (t[0] === "url" || t[0] === "image" || t[0] === "thumb") &&
      typeof t[1] === "string" &&
      t[1].includes(sha256)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Return the protected-event reference for a blob sha, or null if the blob is public
 * (unreferenced by any private/unlisted/space music event). Cached for CACHE_TTL_MS.
 */
export async function getProtectedRefForBlob(sha256: string): Promise<ProtectedEventRef | null> {
  const cached = cache.get(sha256);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ref;

  const rows = await db.execute(
    sql`SELECT pubkey, tags FROM relay.events
        WHERE kind IN (31683, 33123)
        AND visibility IS NOT NULL
        AND tags::text LIKE ${"%" + sha256 + "%"}
        LIMIT 1`,
  );
  const row = (rows as unknown as Array<{ pubkey: string; tags: unknown }>)[0];

  let ref: ProtectedEventRef | null = null;
  if (row) {
    const tags = (typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags) as string[][];
    if (blobShaInTags(tags, sha256)) ref = { pubkey: row.pubkey, tags };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sha256, { ref, at: Date.now() });
  return ref;
}

/**
 * Authorize a viewer against a protected event: the author, a `p`-tag collaborator,
 * or (for `h`-tagged space content) a member of that space. Returns false if unauth.
 */
export async function authorizeProtectedRef(
  ref: ProtectedEventRef,
  authPubkey: string | null | undefined,
): Promise<boolean> {
  if (!authPubkey) return false;
  if (authPubkey === ref.pubkey) return true;
  if (ref.tags.some((t) => t[0] === "p" && t[1] === authPubkey)) return true;

  const hTag = ref.tags.find((t) => t[0] === "h")?.[1];
  if (hTag) {
    const membership = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, hTag), eq(spaceMembers.pubkey, authPubkey)))
      .limit(1);
    return membership.length > 0;
  }
  return false;
}

/** Test/ops hook: drop the protected-status cache (e.g. after visibility changes). */
export function clearBlobAccessCache(): void {
  cache.clear();
}
