import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { spaceRoles, rolePermissions, channelOverrides } from "../db/schema/permissions.js";
import { memberRoles } from "../db/schema/members.js";
import { eq, and, asc } from "drizzle-orm";

interface CreateRoleParams {
  name: string;
  color?: string;
  permissions: string[];
  isAdmin?: boolean;
}

interface UpdateRoleParams {
  name?: string;
  color?: string;
  permissions?: string[];
}

const DEFAULT_MEMBER_PERMISSIONS = ["SEND_MESSAGES", "CREATE_INVITES"];

export const roleService = {
  /** List roles for a space, auto-seeding defaults if empty */
  async listRoles(spaceId: string) {
    let roles = await db
      .select()
      .from(spaceRoles)
      .where(eq(spaceRoles.spaceId, spaceId))
      .orderBy(asc(spaceRoles.position));

    if (roles.length === 0) {
      // Don't auto-seed here — roles are seeded explicitly when space is created
      return [];
    }

    // Attach permissions to each role
    const result = [];
    for (const role of roles) {
      const perms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      result.push({
        ...role,
        permissions: perms.map((p) => p.permission),
      });
    }
    return result;
  },

  /** Create a new role */
  async createRole(spaceId: string, params: CreateRoleParams) {
    const existing = await db
      .select()
      .from(spaceRoles)
      .where(eq(spaceRoles.spaceId, spaceId));
    const nextPosition = existing.length;

    const id = nanoid(12);
    const [role] = await db
      .insert(spaceRoles)
      .values({
        id,
        spaceId,
        name: params.name,
        position: nextPosition,
        color: params.color,
        isDefault: false,
        isAdmin: params.isAdmin ?? false,
      })
      .returning();

    // Insert permissions
    if (params.permissions.length > 0) {
      await db.insert(rolePermissions).values(
        params.permissions.map((p) => ({ roleId: id, permission: p })),
      );
    }

    return { ...role, permissions: params.permissions };
  },

  /** Update a role */
  async updateRole(roleId: string, params: UpdateRoleParams) {
    const updates: Record<string, unknown> = {};
    if (params.name !== undefined) updates.name = params.name;
    if (params.color !== undefined) updates.color = params.color;

    if (Object.keys(updates).length > 0) {
      await db.update(spaceRoles).set(updates).where(eq(spaceRoles.id, roleId));
    }

    // Replace permissions if provided
    if (params.permissions !== undefined) {
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (params.permissions.length > 0) {
        await db.insert(rolePermissions).values(
          params.permissions.map((p) => ({ roleId, permission: p })),
        );
      }
    }

    const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
    const perms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    return { ...role, permissions: perms.map((p) => p.permission) };
  },

  /** Delete a role (refuses default/admin roles) */
  async deleteRole(roleId: string) {
    const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
    if (!role) throw new Error("Role not found");
    if (role.isDefault) throw new Error("Cannot delete a default role");
    if (role.isAdmin) throw new Error("Cannot delete an admin role");

    await db.delete(spaceRoles).where(eq(spaceRoles.id, roleId));
  },

  /** Reorder roles */
  async reorderRoles(spaceId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(spaceRoles)
        .set({ position: i })
        .where(and(eq(spaceRoles.id, orderedIds[i]), eq(spaceRoles.spaceId, spaceId)));
    }
  },

  /** Assign a role to a member */
  async assignRole(spaceId: string, pubkey: string, roleId: string) {
    await db
      .insert(memberRoles)
      .values({ spaceId, pubkey, roleId })
      .onConflictDoNothing();
  },

  /** Remove a role from a member */
  async removeRoleFromMember(spaceId: string, pubkey: string, roleId: string) {
    await db
      .delete(memberRoles)
      .where(
        and(
          eq(memberRoles.spaceId, spaceId),
          eq(memberRoles.pubkey, pubkey),
          eq(memberRoles.roleId, roleId),
        ),
      );
  },

  /** Seed default roles for a new space */
  async seedDefaultRoles(spaceId: string, creatorPubkey: string) {
    // Admin role
    const adminId = nanoid(12);
    await db.insert(spaceRoles).values({
      id: adminId,
      spaceId,
      name: "Admin",
      position: 0,
      isDefault: false,
      isAdmin: true,
    });
    // Admin gets all permissions (isAdmin flag grants everything)

    // Member role
    const memberId = nanoid(12);
    await db.insert(spaceRoles).values({
      id: memberId,
      spaceId,
      name: "Member",
      position: 1,
      isDefault: true,
      isAdmin: false,
    });
    await db.insert(rolePermissions).values(
      DEFAULT_MEMBER_PERMISSIONS.map((p) => ({ roleId: memberId, permission: p })),
    );

    // Assign Admin role to creator
    await db
      .insert(memberRoles)
      .values({ spaceId, pubkey: creatorPubkey, roleId: adminId })
      .onConflictDoNothing();
  },

  /** Get channel overrides for a role */
  async getChannelOverrides(roleId: string) {
    const rows = await db
      .select()
      .from(channelOverrides)
      .where(eq(channelOverrides.roleId, roleId));

    // Group by channelId
    const grouped: Record<string, { allow: string[]; deny: string[] }> = {};
    for (const row of rows) {
      if (!grouped[row.channelId]) {
        grouped[row.channelId] = { allow: [], deny: [] };
      }
      if (row.effect === "allow") {
        grouped[row.channelId].allow.push(row.permission);
      } else {
        grouped[row.channelId].deny.push(row.permission);
      }
    }

    return Object.entries(grouped).map(([channelId, perms]) => ({
      roleId,
      channelId,
      allow: perms.allow,
      deny: perms.deny,
    }));
  },

  /** Set channel overrides for a role (replaces all) */
  async setChannelOverrides(
    roleId: string,
    overrides: Array<{ channelId: string; allow: string[]; deny: string[] }>,
  ) {
    await db.delete(channelOverrides).where(eq(channelOverrides.roleId, roleId));

    const values: Array<{ roleId: string; channelId: string; permission: string; effect: string }> = [];
    for (const o of overrides) {
      for (const p of o.allow) {
        values.push({ roleId, channelId: o.channelId, permission: p, effect: "allow" });
      }
      for (const p of o.deny) {
        values.push({ roleId, channelId: o.channelId, permission: p, effect: "deny" });
      }
    }

    if (values.length > 0) {
      await db.insert(channelOverrides).values(values);
    }
  },

  /** Get effective permissions for a user in a space */
  async getEffectivePermissions(spaceId: string, pubkey: string): Promise<string[]> {
    const roles = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));

    if (roles.length === 0) return [];

    const allPerms = new Set<string>();

    for (const { roleId } of roles) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role?.isAdmin) {
        // Admin gets all permissions
        return [
          "SEND_MESSAGES", "MANAGE_MESSAGES", "MANAGE_MEMBERS", "MANAGE_ROLES",
          "MANAGE_CHANNELS", "MANAGE_SPACE", "VIEW_ANALYTICS", "PIN_MESSAGES",
          "CREATE_INVITES", "MANAGE_INVITES", "BAN_MEMBERS", "MUTE_MEMBERS",
        ];
      }

      const perms = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId));
      for (const p of perms) {
        allPerms.add(p.permission);
      }
    }

    return [...allPerms];
  },

  /** Get member roles */
  async getMemberRoles(spaceId: string, pubkey: string) {
    const rows = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));

    const roles = [];
    for (const { roleId } of rows) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role) roles.push(role);
    }
    return roles;
  },
};
