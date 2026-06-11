import { db } from "../db/connection.js";
import { memberRoles, spaceMembers } from "../db/schema/members.js";
import { spaceRoles, rolePermissions, channelOverrides } from "../db/schema/permissions.js";
import { bans, timedMutes } from "../db/schema/moderation.js";
import { spaces } from "../db/schema/spaces.js";
import { eq, and, gt, or, isNull, inArray } from "drizzle-orm";
import { roleService } from "./roleService.js";

export const permissionService = {
  async check(
    spaceId: string,
    pubkey: string,
    permission: string,
    channelId?: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check bans first — auto-deny ALL permissions if banned
    const now = Math.floor(Date.now() / 1000);
    const activeBan = await db
      .select()
      .from(bans)
      .where(
        and(
          eq(bans.spaceId, spaceId),
          eq(bans.pubkey, pubkey),
          or(isNull(bans.expiresAt), gt(bans.expiresAt, now)),
        ),
      )
      .limit(1);

    if (activeBan.length > 0) {
      return { allowed: false, reason: "Banned" };
    }

    // Check mutes — auto-deny SEND_MESSAGES if muted
    if (permission === "SEND_MESSAGES") {
      const activeMute = await db
        .select()
        .from(timedMutes)
        .where(
          and(
            eq(timedMutes.spaceId, spaceId),
            eq(timedMutes.pubkey, pubkey),
            gt(timedMutes.expiresAt, now),
          ),
        )
        .limit(1);

      if (activeMute.length > 0) {
        // Space-wide mute (no channelId) always applies
        if (!activeMute[0].channelId) {
          return { allowed: false, reason: "Muted" };
        }
        // Channel-specific mute applies if matching
        if (channelId && activeMute[0].channelId === channelId) {
          return { allowed: false, reason: "Muted in channel" };
        }
      }
    }

    // Get member's roles
    const roles = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));

    if (roles.length === 0) {
      // Auto-recover: if this user is the space creator but has no roles,
      // seed roles and assign admin (handles registerSpace failures / old spaces)
      try {
        const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
        if (space?.creatorPubkey === pubkey) {
          await db.insert(spaceMembers).values({ spaceId, pubkey }).onConflictDoNothing();
          const existingRoles = await db.select().from(spaceRoles).where(eq(spaceRoles.spaceId, spaceId));
          if (existingRoles.length === 0) {
            await roleService.seedDefaultRoles(spaceId, pubkey);
          } else {
            const adminRole = existingRoles.find((r) => r.isAdmin);
            if (adminRole) {
              await db.insert(memberRoles).values({ spaceId, pubkey, roleId: adminRole.id }).onConflictDoNothing();
            }
          }
          // Retry after auto-recovery (only once — roles should exist now)
          const retryRoles = await db
            .select({ roleId: memberRoles.roleId })
            .from(memberRoles)
            .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));
          if (retryRoles.length > 0) {
            return this.check(spaceId, pubkey, permission, channelId);
          }
        }
      } catch {
        // Auto-recovery failed (e.g., space doesn't exist in DB) — fall through
      }
      return { allowed: false, reason: "Not a member" };
    }

    // Batched (#105): load the member's roles, channel overrides, and base grants
    // for THIS permission in a constant number of queries instead of per role.
    const roleIds = roles.map((r) => r.roleId);

    // Admin bypass.
    const roleRows = await db.select().from(spaceRoles).where(inArray(spaceRoles.id, roleIds));
    if (roleRows.some((r) => r.isAdmin)) return { allowed: true, reason: "Admin role" };

    // Per-role channel override for this channel+permission (first wins per role,
    // mirroring the original `overrides[0]`).
    const overrideEffectByRole = new Map<string, string>();
    if (channelId) {
      const overrideRows = await db
        .select()
        .from(channelOverrides)
        .where(
          and(
            inArray(channelOverrides.roleId, roleIds),
            eq(channelOverrides.channelId, channelId),
            eq(channelOverrides.permission, permission),
          ),
        );
      for (const o of overrideRows) {
        if (!overrideEffectByRole.has(o.roleId)) overrideEffectByRole.set(o.roleId, o.effect);
      }
    }

    // Roles that grant this permission at the base level.
    const basePermRows = await db
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions)
      .where(and(inArray(rolePermissions.roleId, roleIds), eq(rolePermissions.permission, permission)));
    const baseGrantRoles = new Set(basePermRows.map((r) => r.roleId));

    // Deny-wins, evaluated per role exactly as before: a channel override (deny or
    // allow) decides that role and skips its base check; otherwise the base grant
    // applies.
    let anyAllows = false;
    let anyDenies = false;
    for (const roleId of roleIds) {
      const effect = overrideEffectByRole.get(roleId);
      if (effect === "deny") { anyDenies = true; continue; }
      if (effect === "allow") { anyAllows = true; continue; }
      if (baseGrantRoles.has(roleId)) anyAllows = true;
    }

    if (anyDenies) {
      return { allowed: false, reason: "Denied by channel override" };
    }
    if (anyAllows) {
      return { allowed: true };
    }

    return { allowed: false, reason: "No permission" };
  },

  /** Check role hierarchy — returns true if actor outranks target.
   *  Lower position = higher rank. Only the space creator can moderate other admins. */
  async checkHierarchy(
    spaceId: string,
    actorPubkey: string,
    targetPubkey: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (actorPubkey === targetPubkey) {
      return { allowed: false, reason: "Cannot moderate yourself" };
    }

    // Get actor's roles with positions
    const actorRoleRows = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, actorPubkey)));

    let actorBestPosition = Infinity;
    let actorIsAdmin = false;
    for (const { roleId } of actorRoleRows) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role) {
        if (role.position < actorBestPosition) actorBestPosition = role.position;
        if (role.isAdmin) actorIsAdmin = true;
      }
    }

    // Get target's roles with positions
    const targetRoleRows = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, targetPubkey)));

    let targetBestPosition = Infinity;
    let targetIsAdmin = false;
    for (const { roleId } of targetRoleRows) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role) {
        if (role.position < targetBestPosition) targetBestPosition = role.position;
        if (role.isAdmin) targetIsAdmin = true;
      }
    }

    // Admin vs admin: only space creator can moderate other admins
    // (creator check is left to the caller since we don't have creatorPubkey here)
    if (targetIsAdmin && !actorIsAdmin) {
      return { allowed: false, reason: "Cannot moderate an admin" };
    }

    // Actor must have a strictly lower position number (= higher rank) than target
    if (actorBestPosition >= targetBestPosition) {
      return { allowed: false, reason: "Cannot moderate a user with equal or higher role" };
    }

    return { allowed: true };
  },
};
