import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { spaceRoles, rolePermissions, channelOverrides } from "../db/schema/permissions.js";
import { memberRoles, spaceMembers } from "../db/schema/members.js";
import { spaces } from "../db/schema/spaces.js";
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

const DEFAULT_MEMBER_PERMISSIONS = [
  "SEND_MESSAGES", "CREATE_INVITES", "EMBED_LINKS", "ATTACH_FILES",
  "ADD_REACTIONS", "CONNECT", "SPEAK", "VIDEO", "SCREEN_SHARE",
  "VIEW_CHANNEL", "READ_MESSAGE_HISTORY",
];

/**
 * In-memory lock to serialize concurrent seedDefaultRoles calls for the same space.
 * Prevents the TOCTOU race where multiple requests all see 0 roles and all insert.
 */
const seedLocks = new Map<string, Promise<void>>();

export const roleService = {
  /** List roles for a space, auto-seeding defaults if empty */
  async listRoles(spaceId: string) {
    let roles = await db
      .select()
      .from(spaceRoles)
      .where(eq(spaceRoles.spaceId, spaceId))
      .orderBy(asc(spaceRoles.position));

    if (roles.length === 0) {
      // Auto-seed roles if the space exists but has no roles yet
      // (handles cases where registerSpace() failed or old spaces)
      try {
        const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
        if (space?.creatorPubkey) {
          await this.seedDefaultRoles(spaceId, space.creatorPubkey);
          // Re-query after seeding
          roles = await db
            .select()
            .from(spaceRoles)
            .where(eq(spaceRoles.spaceId, spaceId))
            .orderBy(asc(spaceRoles.position));
        }
      } catch {
        // Space doesn't exist in DB — can't seed
      }
      if (roles.length === 0) return [];
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

  /** Seed default roles for a new space (idempotent + serialized per space).
   *  Uses an in-memory lock to prevent concurrent calls from creating duplicates. */
  async seedDefaultRoles(spaceId: string, creatorPubkey: string) {
    // Serialize: if another call is already seeding this space, wait for it
    const inflight = seedLocks.get(spaceId);
    if (inflight) {
      await inflight;
      // After waiting, ensure creator has admin role (the first call may have used a different pubkey)
      const existing = await db.select().from(spaceRoles).where(eq(spaceRoles.spaceId, spaceId));
      const adminRole = existing.find((r) => r.isAdmin);
      if (adminRole) {
        await db.insert(spaceMembers).values({ spaceId, pubkey: creatorPubkey }).onConflictDoNothing();
        await db.insert(memberRoles).values({ spaceId, pubkey: creatorPubkey, roleId: adminRole.id }).onConflictDoNothing();
      }
      return;
    }

    const promise = this._doSeedDefaultRoles(spaceId, creatorPubkey);
    seedLocks.set(spaceId, promise);
    try {
      await promise;
    } finally {
      seedLocks.delete(spaceId);
    }
  },

  /** Internal: actual seeding logic (called under lock) */
  async _doSeedDefaultRoles(spaceId: string, creatorPubkey: string) {
    // Guard: skip if roles already exist
    const existing = await db.select().from(spaceRoles).where(eq(spaceRoles.spaceId, spaceId));
    if (existing.length > 0) {
      // Ensure creator has admin role assigned even if roles already exist
      const adminRole = existing.find((r) => r.isAdmin);
      if (adminRole) {
        await db.insert(spaceMembers).values({ spaceId, pubkey: creatorPubkey }).onConflictDoNothing();
        await db.insert(memberRoles).values({ spaceId, pubkey: creatorPubkey, roleId: adminRole.id }).onConflictDoNothing();
      }
      return;
    }

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

    // Register creator as a member of the space
    await db
      .insert(spaceMembers)
      .values({ spaceId, pubkey: creatorPubkey })
      .onConflictDoNothing();

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

    if (roles.length === 0) {
      // Auto-seed roles if the space exists and this user is the creator
      try {
        const [space] = await db.select().from(spaces).where(eq(spaces.id, spaceId)).limit(1);
        if (space?.creatorPubkey === pubkey) {
          await db.insert(spaceMembers).values({ spaceId, pubkey }).onConflictDoNothing();
          const existing = await db.select().from(spaceRoles).where(eq(spaceRoles.spaceId, spaceId));
          if (existing.length === 0) {
            await this.seedDefaultRoles(spaceId, pubkey);
          } else {
            const adminRole = existing.find((r) => r.isAdmin);
            if (adminRole) {
              await db.insert(memberRoles).values({ spaceId, pubkey, roleId: adminRole.id }).onConflictDoNothing();
            }
          }
          return this.getEffectivePermissions(spaceId, pubkey);
        }
      } catch {
        // Auto-recovery failed — fall through
      }
      return [];
    }

    const allPerms = new Set<string>();

    for (const { roleId } of roles) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role?.isAdmin) {
        // Admin gets all permissions
        return [
          "SEND_MESSAGES", "MANAGE_MESSAGES", "PIN_MESSAGES", "EMBED_LINKS",
          "ATTACH_FILES", "ADD_REACTIONS", "MENTION_EVERYONE",
          "CONNECT", "SPEAK", "VIDEO", "SCREEN_SHARE",
          "VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "MANAGE_CHANNELS",
          "MANAGE_MEMBERS", "MANAGE_ROLES", "CREATE_INVITES", "MANAGE_INVITES",
          "BAN_MEMBERS", "MUTE_MEMBERS", "MANAGE_SPACE", "VIEW_ANALYTICS",
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

  /** Get effective permissions for a user in a space, including per-channel overrides.
   *  Returns space-level permissions + aggregated channel overrides (deny-wins model). */
  async getEffectiveChannelPermissions(
    spaceId: string,
    pubkey: string,
  ): Promise<{
    spacePermissions: string[];
    channelOverrides: Record<string, { allow: string[]; deny: string[] }>;
  }> {
    const spacePerms = await this.getEffectivePermissions(spaceId, pubkey);

    // Get member's role IDs
    const roles = await db
      .select({ roleId: memberRoles.roleId })
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, spaceId), eq(memberRoles.pubkey, pubkey)));

    // Check if user is admin — admins have no overrides (all perms everywhere)
    for (const { roleId } of roles) {
      const [role] = await db.select().from(spaceRoles).where(eq(spaceRoles.id, roleId)).limit(1);
      if (role?.isAdmin) {
        return { spacePermissions: spacePerms, channelOverrides: {} };
      }
    }

    // Aggregate channel overrides across all roles (deny-wins model)
    const aggregated: Record<string, { allow: Set<string>; deny: Set<string> }> = {};

    for (const { roleId } of roles) {
      const rows = await db
        .select()
        .from(channelOverrides)
        .where(eq(channelOverrides.roleId, roleId));

      for (const row of rows) {
        if (!aggregated[row.channelId]) {
          aggregated[row.channelId] = { allow: new Set(), deny: new Set() };
        }
        if (row.effect === "deny") {
          aggregated[row.channelId].deny.add(row.permission);
        } else if (row.effect === "allow") {
          aggregated[row.channelId].allow.add(row.permission);
        }
      }
    }

    // Apply deny-wins: remove from allow anything that's also in deny
    const result: Record<string, { allow: string[]; deny: string[] }> = {};
    for (const [channelId, { allow, deny }] of Object.entries(aggregated)) {
      for (const p of deny) {
        allow.delete(p); // deny wins over allow
      }
      result[channelId] = { allow: [...allow], deny: [...deny] };
    }

    return { spacePermissions: spacePerms, channelOverrides: result };
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

  /** Get all members with their assigned roles (bulk) */
  async getAllMembersWithRoles(spaceId: string) {
    const members = await db
      .select()
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, spaceId));

    const allAssignments = await db
      .select()
      .from(memberRoles)
      .where(eq(memberRoles.spaceId, spaceId));

    const roles = await db
      .select()
      .from(spaceRoles)
      .where(eq(spaceRoles.spaceId, spaceId))
      .orderBy(asc(spaceRoles.position));

    const roleMap = new Map(roles.map((r) => [r.id, r]));

    // Build pubkey → roles mapping
    const memberRoleMap = new Map<string, typeof roles>();
    for (const assignment of allAssignments) {
      const role = roleMap.get(assignment.roleId);
      if (role) {
        const existing = memberRoleMap.get(assignment.pubkey) ?? [];
        existing.push(role);
        memberRoleMap.set(assignment.pubkey, existing);
      }
    }

    return members.map((m) => ({
      pubkey: m.pubkey,
      roles: memberRoleMap.get(m.pubkey) ?? [],
      joinedAt: m.joinedAt ? new Date(m.joinedAt).getTime() : 0,
    }));
  },
};
