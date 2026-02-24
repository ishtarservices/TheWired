import { db } from "../db/connection.js";
import { memberRoles } from "../db/schema/members.js";
import { spaceRoles, rolePermissions, channelOverrides } from "../db/schema/permissions.js";
import { eq, and } from "drizzle-orm";

export const permissionService = {
  async check(
    spaceId: string,
    pubkey: string,
    permission: string,
    channelId?: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Get member's roles
    const roles = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));

    if (roles.length === 0) {
      return { allowed: false, reason: "Not a member" };
    }

    // Check if any role is admin
    for (const { roleId } of roles) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role?.isAdmin) return { allowed: true, reason: "Admin role" };
    }

    // Check role permissions
    for (const { roleId } of roles) {
      const perms = await db
        .select()
        .from(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permission, permission)));
      if (perms.length > 0) {
        // Check channel override if applicable
        if (channelId) {
          const overrides = await db
            .select()
            .from(channelOverrides)
            .where(
              and(
                eq(channelOverrides.roleId, roleId),
                eq(channelOverrides.channelId, channelId),
                eq(channelOverrides.permission, permission),
              ),
            );
          if (overrides.length > 0 && overrides[0].effect === "deny") {
            continue;
          }
        }
        return { allowed: true };
      }
    }

    return { allowed: false, reason: "No permission" };
  },
};
