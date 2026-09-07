/**
 * Shared access control for protected (private/unlisted/space) music blobs.
 *
 * A blob is "protected" when a kind 31683/33123 event AUTHORED BY ONE OF ITS
 * UPLOADERS references it and carries a `visibility` (private/unlisted) or `h`
 * (space) tag. Both the raw-blob route (routes/blossom.ts) and the HLS route
 * (routes/hls.ts) consult this module to decide whether an untokened request may
 * be served. Results are cached briefly so the HLS hot path doesn't re-query on
 * every segment.
 *
 * Semantics (deterministic — see docs/MUSIC_VISIBILITY.md):
 * - Only events authored by an uploader of the blob (app.blob_owners /
 *   app.music_uploads) count. A third party publishing an event that references
 *   someone else's sha can neither protect nor expose the blob (no griefing
 *   kill-switch on public tracks, no unlock of private ones).
 * - If ANY owner-authored referencing event is public, the blob is public: that
 *   owner has published the content openly, so gating the bytes is moot.
 * - Otherwise, if owner-authored protected events reference it, the blob is
 *   protected and a viewer must be authorized against AT LEAST ONE of them.
 *   For `h`-tagged content that means membership of ANY of the event's listed
 *   spaces (a multi-space track carries one `h` tag per space).
 * - A blob with no owner-authored referencing events (just uploaded, not yet
 *   published, or referenced only via NIP-44-encrypted tags) is public by URL —
 *   the sha itself is the capability in that window.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaceMembers } from "../db/schema/members.js";
import { and, eq, inArray } from "drizzle-orm";

export interface ProtectedEventRef {
  pubkey: string;
  tags: string[][];
}

interface CacheEntry {
  refs: ProtectedEventRef[];
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

/** p-tag roles that unlock protected content (see {@link pTagGrantsAccess}). */
const ACCESS_ROLES: ReadonlySet<string> = new Set(["artist", "collaborator", "contributor", "editor"]);

/**
 * Does a `p` tag grant protected-content access to `pubkey`? Role-aware: the
 * 4th element distinguishes credits from access grants.
 *
 * Grants: `artist` (co-author identity) and the three project MEMBER roles the
 * mobile app writes — `collaborator` (viewer), `contributor` (may add their own
 * tracks via kind-31685 proposals), `editor` (may propose any change). Every
 * member must be able to play the media they are a member of, so all three
 * unlock private/space content identically; what they may *propose* is decided
 * by the owner's app when it applies a proposal, not here.
 *
 * `featured` (and any unknown role) is a credit only. A bare role-less p-tag
 * keeps granting for legacy events that predate roles.
 */
export function pTagGrantsAccess(tag: string[], pubkey: string): boolean {
  if (tag[0] !== "p" || tag[1] !== pubkey) return false;
  const role = tag[3];
  return !role || ACCESS_ROLES.has(role);
}

/**
 * Return every protected owner-authored event reference for a blob sha. An empty
 * array means the blob is public (see module docs for the exact semantics).
 * Cached for CACHE_TTL_MS.
 */
export async function getProtectedRefsForBlob(sha256: string): Promise<ProtectedEventRef[]> {
  const cached = cache.get(sha256);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.refs;

  // Owner-authored music events that mention the sha anywhere in their tags.
  // `visibility` and `h_tag` are populated by the relay at insert time
  // (services/relay/src/db/event_store.rs) and backfilled by its migrations.
  const rows = (await db.execute(
    sql`SELECT e.pubkey, e.tags,
               (e.visibility IS NOT NULL OR e.h_tag IS NOT NULL) AS is_protected
        FROM relay.events e
        JOIN (
          SELECT pubkey FROM app.blob_owners WHERE sha256 = ${sha256}
          UNION
          SELECT pubkey FROM app.music_uploads WHERE sha256 = ${sha256}
        ) owners ON owners.pubkey = e.pubkey
        WHERE e.kind IN (31683, 33123)
        AND e.tags::text LIKE ${"%" + sha256 + "%"}`,
  )) as unknown as Array<{ pubkey: string; tags: unknown; is_protected: boolean }>;

  let anyPublicRef = false;
  const protectedRefs: ProtectedEventRef[] = [];
  for (const row of rows) {
    const tags = (typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags) as string[][];
    if (!blobShaInTags(tags, sha256)) continue;
    if (row.is_protected) {
      protectedRefs.push({ pubkey: row.pubkey, tags });
    } else {
      anyPublicRef = true;
    }
  }

  // An owner publishing the content publicly overrides any protected reference.
  const refs = anyPublicRef ? [] : protectedRefs;

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(sha256, { refs, at: Date.now() });
  return refs;
}

/**
 * Authorize a viewer against ONE protected event: the author, an access-granting
 * `p`-tag (see {@link pTagGrantsAccess}), or (for `h`-tagged space content) a
 * member of ANY of its listed spaces. Returns false if unauthenticated.
 */
export async function authorizeProtectedRef(
  ref: ProtectedEventRef,
  authPubkey: string | null | undefined,
): Promise<boolean> {
  if (!authPubkey) return false;
  if (authPubkey === ref.pubkey) return true;
  if (ref.tags.some((t) => pTagGrantsAccess(t, authPubkey))) return true;

  const hTags = ref.tags.filter((t) => t[0] === "h" && t[1]).map((t) => t[1]);
  if (hTags.length > 0) {
    const membership = await db
      .select({ spaceId: spaceMembers.spaceId })
      .from(spaceMembers)
      .where(and(inArray(spaceMembers.spaceId, hTags), eq(spaceMembers.pubkey, authPubkey)))
      .limit(1);
    return membership.length > 0;
  }
  return false;
}

/** Authorize a viewer against a set of protected refs: any one grants access. */
export async function authorizeProtectedRefs(
  refs: ProtectedEventRef[],
  authPubkey: string | null | undefined,
): Promise<boolean> {
  for (const ref of refs) {
    if (await authorizeProtectedRef(ref, authPubkey)) return true;
  }
  return false;
}

/** Test/ops hook: drop the protected-status cache (e.g. after visibility changes). */
export function clearBlobAccessCache(): void {
  cache.clear();
}
