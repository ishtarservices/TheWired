import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicProposals } from "../db/schema/proposals.js";
import { nanoid } from "../lib/id.js";
import { fetchLatestByAddressableId, isEventVisibleTo } from "./musicVisibility.js";

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ── Listen requests ─────────────────────────────────────────────────────
// A listen request is a kind-31685 proposal carrying one `grant_access`
// change: "add me as a viewer of this private track/project". Clients derive
// its d-tag from the target, so asking again replaces the same addressable
// event. These gates decide what reaches an owner's inbox. The relay's limits
// are per connection and keys are free, so the inbox has to protect itself.

/** A declined requester may ask again after this long. */
export const ACCESS_REQUEST_COOLDOWN_SEC = 7 * 24 * 60 * 60;
/** Open listen requests one account may have across all owners. */
export const MAX_OPEN_ACCESS_REQUESTS = 25;
/** Rows the owner's inbox route returns (newest first). */
export const INCOMING_LIMIT = 200;

const ACCESS_TARGET = /^(31683|33123):[0-9a-f]{64}:.+$/;
const GRANT_ACCESS_JSON = JSON.stringify([{ type: "grant_access" }]);
const isGrantAccessRow = sql`${musicProposals.changes} @> ${GRANT_ACCESS_JSON}::jsonb`;

export function isAccessRequestChanges(changes: unknown): boolean {
  return (
    Array.isArray(changes) &&
    changes.some((c) => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "grant_access")
  );
}

/** May this listen request reach the owner at all? The target must exist,
 *  belong to the `p`-tagged owner, and be something the requester can NOT
 *  already see. Visibility is the backend's own policy, so a public target, a
 *  requester who already holds a granting p-tag, or a member of the target's
 *  space is turned away here. */
async function admitAccessTarget(targetRef: string, ownerPubkey: string, proposer: string): Promise<boolean> {
  if (!ACCESS_TARGET.test(targetRef) || proposer === ownerPubkey) return false;
  const target = await fetchLatestByAddressableId(targetRef);
  if (!target || target.pubkey !== ownerPubkey) return false;
  return !(await isEventVisibleTo(target, ownerPubkey, proposer));
}

/** Per-requester state across d-tags: is one already waiting, were they
 *  declined recently, and are they at the open cap? */
async function accessRequestBlocked(proposer: string, targetRef: string, now: number): Promise<boolean> {
  const sameTarget = await db
    .select({ status: musicProposals.status, resolvedAt: musicProposals.resolvedAt })
    .from(musicProposals)
    .where(
      and(
        eq(musicProposals.proposerPubkey, proposer),
        eq(musicProposals.targetAlbum, targetRef),
        isGrantAccessRow,
      ),
    );
  if (sameTarget.some((r) => r.status === "open")) return true;
  if (sameTarget.some((r) => r.status === "rejected" && (r.resolvedAt ?? 0) > now - ACCESS_REQUEST_COOLDOWN_SEC)) {
    return true;
  }
  const [{ open }] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(musicProposals)
    .where(and(eq(musicProposals.proposerPubkey, proposer), eq(musicProposals.status, "open"), isGrantAccessRow));
  return open >= MAX_OPEN_ACCESS_REQUESTS;
}

export const proposalService = {
  /**
   * Index a kind-31685 event. One row per addressable event: a re-delivered
   * or older event is a no-op, and a newer one replaces the row's content. The
   * backend owns status, so the event's own `status` tag is ignored and every
   * admitted event is `open`.
   */
  async indexProposal(event: NostrEvent) {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    const targetAlbum = event.tags.find((t) => t[0] === "a")?.[1];
    const ownerPubkey = event.tags.find((t) => t[0] === "p")?.[1];

    if (!dTag || !targetAlbum || !ownerPubkey) return;
    // The `p` tag names who may resolve the proposal, so it must be the
    // target's author. The address carries the author, so this holds even for
    // a project we have not seen yet (relay delivery order is not guaranteed).
    if (targetAlbum.split(":")[1] !== ownerPubkey) return;

    let parsed: { title?: unknown; description?: unknown; changes?: unknown };
    try {
      parsed = JSON.parse(event.content);
    } catch {
      return;
    }
    if (!Array.isArray(parsed?.changes) || parsed.changes.length === 0) return;
    const access = isAccessRequestChanges(parsed.changes);

    if (access) {
      if (!(await admitAccessTarget(targetAlbum, ownerPubkey, event.pubkey))) return;
    } else {
      const project = await fetchLatestByAddressableId(targetAlbum);
      if (project && project.pubkey !== ownerPubkey) return;
    }

    const addressableId = `31685:${event.pubkey}:${dTag}`;
    const now = Math.floor(Date.now() / 1000);
    const fields = {
      title: typeof parsed.title === "string" ? parsed.title : "",
      description: typeof parsed.description === "string" ? parsed.description : null,
      // A listen request is stored in its one canonical shape.
      changes: (access ? [{ type: "grant_access", role: "viewer" }] : parsed.changes) as unknown as Record<
        string,
        unknown
      >,
      eventId: event.id,
      createdAt: event.created_at,
    };

    const [existing] = await db
      .select()
      .from(musicProposals)
      .where(eq(musicProposals.addressableId, addressableId))
      .limit(1);

    if (existing) {
      // The same event again (relay replay), or an older version: nothing to do.
      if (event.created_at <= existing.createdAt) return;
      if (access && existing.status !== "open") {
        // Asking again after a decline waits out the cooldown, and a reopen
        // counts against the requester's open cap like a new request.
        if (existing.status === "rejected" && (existing.resolvedAt ?? 0) > now - ACCESS_REQUEST_COOLDOWN_SEC) return;
        if (await accessRequestBlocked(event.pubkey, targetAlbum, now)) return;
      }
      await db
        .update(musicProposals)
        .set({ ...fields, status: "open", resolvedAt: null })
        .where(and(eq(musicProposals.id, existing.id), sql`${musicProposals.createdAt} < ${event.created_at}`));
      return;
    }

    if (access && (await accessRequestBlocked(event.pubkey, targetAlbum, now))) return;

    await db
      .insert(musicProposals)
      .values({
        id: nanoid(16),
        proposalId: dTag,
        addressableId,
        targetAlbum,
        proposerPubkey: event.pubkey,
        ownerPubkey,
        ...fields,
        status: "open",
      })
      // A concurrent delivery of the same event won the race: fine.
      .onConflictDoNothing({ target: musicProposals.addressableId });
  },

  /** Tracklist proposals against a project. Listen requests are the owner's
   *  alone (who asked to hear what), so they never appear here. */
  async getProposalsForAlbum(targetAlbum: string) {
    return db
      .select()
      .from(musicProposals)
      .where(and(eq(musicProposals.targetAlbum, targetAlbum), sql`NOT (${isGrantAccessRow})`))
      .orderBy(desc(musicProposals.createdAt));
  },

  async getIncomingProposals(ownerPubkey: string) {
    return db
      .select()
      .from(musicProposals)
      .where(
        and(
          eq(musicProposals.ownerPubkey, ownerPubkey),
          eq(musicProposals.status, "open"),
        ),
      )
      .orderBy(desc(musicProposals.createdAt))
      .limit(INCOMING_LIMIT);
  },

  async resolveProposal(id: string, status: "accepted" | "rejected", requesterPubkey: string) {
    // Verify the requester is the album owner
    const rows = await db
      .select()
      .from(musicProposals)
      .where(eq(musicProposals.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    if (rows[0].ownerPubkey !== requesterPubkey) return "forbidden";
    if (rows[0].status !== "open") return "already_resolved";

    const now = Math.floor(Date.now() / 1000);
    const updated = await db
      .update(musicProposals)
      .set({ status, resolvedAt: now })
      .where(and(eq(musicProposals.id, id), eq(musicProposals.status, "open")))
      .returning({ id: musicProposals.id });

    // A second resolve raced this one between the read and the write.
    return updated.length > 0 ? "ok" : "already_resolved";
  },
};
