import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { spaces } from "../db/schema/spaces.js";
import { spaceMembers, memberRoles } from "../db/schema/members.js";
import { spaceRoles } from "../db/schema/permissions.js";

type Db = typeof db;
/** A drizzle transaction handle, or the pool itself. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Recompute `app.spaces.member_count` from `app.space_members`.
 *
 * Every path that adds or removes a member calls this in the same transaction
 * as the row change. Recounting (one index scan on the space_members primary
 * key) instead of ±1 means a counter that drifted in the past is corrected by
 * the next membership change rather than carried forward.
 *
 * Relay-native (nip29) spaces are skipped: their membership lives on the relay
 * and their count is `mirrored_member_count`.
 */
export async function refreshMemberCount(exec: Executor, spaceId: string): Promise<number | null> {
  const [row] = await exec
    .update(spaces)
    .set({
      memberCount: sql`(SELECT count(*)::int FROM ${spaceMembers} WHERE ${spaceMembers.spaceId} = ${spaceId})`,
    })
    .where(and(eq(spaces.id, spaceId), ne(spaces.spaceMode, "nip29")))
    .returning({ memberCount: spaces.memberCount });
  return row?.memberCount ?? null;
}

/** Current members who are admins: an admin role in this space, or the creator. */
async function adminMembers(exec: Executor, spaceId: string, creatorPubkey: string | null): Promise<Set<string>> {
  const rows = await exec
    .select({ pubkey: memberRoles.pubkey })
    .from(memberRoles)
    .innerJoin(spaceRoles, and(eq(spaceRoles.id, memberRoles.roleId), eq(spaceRoles.spaceId, spaceId)))
    .innerJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, memberRoles.spaceId), eq(spaceMembers.pubkey, memberRoles.pubkey)),
    )
    .where(and(eq(memberRoles.spaceId, spaceId), eq(spaceRoles.isAdmin, true)));
  const admins = new Set(rows.map((r) => r.pubkey));
  if (creatorPubkey) {
    const [creatorRow] = await exec
      .select({ pubkey: spaceMembers.pubkey })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, creatorPubkey)))
      .limit(1);
    if (creatorRow) admins.add(creatorPubkey);
  }
  return admins;
}

export type LeaveResult = "left" | "not_member" | "last_admin";

/**
 * Remove `pubkey` from a space.
 *
 * - The last admin can't leave ("last_admin"): they promote someone or delete
 *   the space. The relay applies the same rule to NIP-29 groups.
 * - A creator who leaves while another admin remains gives up ownership
 *   (`creator_pubkey` → NULL), so creator-only actions fall to MANAGE_SPACE
 *   holders and the permission check no longer re-adds them.
 *
 * The space row is locked for the duration, so two admins leaving at once
 * are serialised and can't both pass the "another admin remains" check.
 */
export async function leaveSpace(spaceId: string, pubkey: string): Promise<LeaveResult> {
  return db.transaction(async (tx) => {
    const [space] = await tx
      .select({ creatorPubkey: spaces.creatorPubkey })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .for("update");

    const [membership] = await tx
      .select({ pubkey: spaceMembers.pubkey })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);

    if (membership && space) {
      const admins = await adminMembers(tx, spaceId, space.creatorPubkey);
      if (admins.has(pubkey) && admins.size === 1) return "last_admin";
    }

    await tx.delete(memberRoles).where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));
    if (!membership) return "not_member";

    await tx.delete(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)));
    if (space?.creatorPubkey === pubkey) {
      await tx.update(spaces).set({ creatorPubkey: null }).where(eq(spaces.id, spaceId));
    }
    await refreshMemberCount(tx, spaceId);
    return "left";
  });
}
