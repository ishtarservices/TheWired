import { z } from "zod";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { roleService } from "../services/roleService.js";
import { permissionService } from "../services/permissionService.js";
import { gateSpaceRead } from "../lib/spaceReadGate.js";
import { profileCacheService, toMemberProfile, PROFILE_JOIN_CAP } from "../services/profileCacheService.js";
import {
  requirePubkey,
  requireSpaceCreator,
  isSpaceCreator,
  requireRoleInSpace,
  getActorRank,
  canManageRole,
  unknownPermissions,
  ungrantablePermissions,
  type ActorRank,
} from "../lib/authz.js";
import { notifySpaceChanged } from "../services/spaceSignalService.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const spaceIdParamsSchema = z.object({
  spaceId: nonEmptyString,
});

const spaceAndRoleIdParamsSchema = z.object({
  spaceId: nonEmptyString,
  roleId: nonEmptyString,
});

const spaceAndPubkeyParamsSchema = z.object({
  spaceId: nonEmptyString,
  pubkey: hexId,
});

const spaceRolePubkeyParamsSchema = z.object({
  spaceId: nonEmptyString,
  pubkey: hexId,
  roleId: nonEmptyString,
});

const createRoleBodySchema = z.object({
  name: nonEmptyString.max(100),
  color: z.string().max(32).optional(),
  permissions: z.array(z.string()).max(64),
  isAdmin: z.boolean().optional(),
});

const updateRoleBodySchema = z.object({
  name: z.string().max(100).optional(),
  color: z.string().max(32).optional(),
  permissions: z.array(z.string()).max(64).optional(),
});

/** 400 for permission names that don't exist, 403 for ones the actor may not grant. */
function checkGrantable(rank: ActorRank, perms: string[], reply: FastifyReply): boolean {
  const unknown = unknownPermissions(perms);
  if (unknown.length > 0) {
    reply.status(400).send({ error: `Unknown permissions: ${unknown.join(", ")}`, code: "INVALID_PERMISSION" });
    return false;
  }
  const denied = ungrantablePermissions(rank, perms);
  if (denied.length > 0) {
    reply.status(403).send({ error: `Cannot grant permissions you do not hold: ${denied.join(", ")}`, code: "FORBIDDEN" });
    return false;
  }
  return true;
}

const reorderBodySchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const overridesBodySchema = z.object({
  overrides: z.array(z.object({
    channelId: nonEmptyString,
    allow: z.array(z.string()),
    deny: z.array(z.string()),
  })),
});

const assignRoleBodySchema = z.object({
  roleId: nonEmptyString,
});

export const rolesRoutes: FastifyPluginAsync = async (server) => {
  // ── Roles CRUD ──────────────────────────────────────────────

  /** GET /:spaceId/roles — List roles */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/roles",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      if (!(await gateSpaceRead(request, reply, params.spaceId, "roles"))) return;
      const roles = await roleService.listRoles(params.spaceId);
      return { data: roles };
    },
  );

  /** POST /:spaceId/roles — Create role */
  server.post<{
    Params: { spaceId: string };
    Body: { name: string; color?: string; permissions: string[]; isAdmin?: boolean };
  }>(
    "/:spaceId/roles",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(createRoleBodySchema, request.body, reply);
      if (!body) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      // Only the creator mints admin roles; everyone else grants only what they hold.
      const rank = await getActorRank(params.spaceId, pubkey);
      if (body.isAdmin && !rank.isCreator) {
        return reply.status(403).send({ error: "Only the space creator can create admin roles", code: "CREATOR_ONLY" });
      }
      if (!checkGrantable(rank, body.permissions, reply)) return;

      const role = await roleService.createRole(params.spaceId, body);
      notifySpaceChanged(params.spaceId, "roles");
      return { data: role };
    },
  );

  /** PATCH /:spaceId/roles/:roleId — Update role */
  server.patch<{
    Params: { spaceId: string; roleId: string };
    Body: { name?: string; color?: string; permissions?: string[] };
  }>(
    "/:spaceId/roles/:roleId",
    async (request, reply) => {
      const params = validate(spaceAndRoleIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(updateRoleBodySchema, request.body, reply);
      if (!body) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      const target = await requireRoleInSpace(params.spaceId, params.roleId, reply);
      if (!target) return;
      const rank = await getActorRank(params.spaceId, pubkey);
      if (!canManageRole(rank, target)) {
        return reply.status(403).send({ error: "Cannot modify a role equal to or above your own", code: "FORBIDDEN" });
      }
      if (body.permissions !== undefined && !checkGrantable(rank, body.permissions, reply)) return;

      try {
        const role = await roleService.updateRole(params.spaceId, params.roleId, body);
        notifySpaceChanged(params.spaceId, "roles");
        return { data: role };
      } catch (err: any) {
        return reply.status(404).send({ error: err.message, code: "NOT_FOUND" });
      }
    },
  );

  /** DELETE /:spaceId/roles/:roleId — Delete role */
  server.delete<{ Params: { spaceId: string; roleId: string } }>(
    "/:spaceId/roles/:roleId",
    async (request, reply) => {
      const params = validate(spaceAndRoleIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      const target = await requireRoleInSpace(params.spaceId, params.roleId, reply);
      if (!target) return;
      const rank = await getActorRank(params.spaceId, pubkey);
      if (!canManageRole(rank, target)) {
        return reply.status(403).send({ error: "Cannot delete a role equal to or above your own", code: "FORBIDDEN" });
      }

      try {
        await roleService.deleteRole(params.spaceId, params.roleId);
        notifySpaceChanged(params.spaceId, ["roles", "members"]);
        return { data: { success: true } };
      } catch (err: any) {
        const notFound = err.message === "Role not found";
        return reply.status(notFound ? 404 : 400).send({ error: err.message, code: notFound ? "NOT_FOUND" : "BAD_REQUEST" });
      }
    },
  );

  /** POST /:spaceId/roles/reorder — Reorder roles */
  server.post<{
    Params: { spaceId: string };
    Body: { orderedIds: string[] };
  }>(
    "/:spaceId/roles/reorder",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(reorderBodySchema, request.body, reply);
      if (!body) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      // Non-creators may only shuffle roles strictly below their own: nothing
      // at or above their rank (or any admin role) may change position, and
      // nothing may be moved up into that band.
      const rank = await getActorRank(params.spaceId, pubkey);
      if (!rank.isCreator) {
        const byId = new Map((await roleService.listRoles(params.spaceId)).map((r) => [r.id, r]));
        for (let i = 0; i < body.orderedIds.length; i++) {
          const role = byId.get(body.orderedIds[i]);
          if (!role) return reply.status(404).send({ error: "Role not found", code: "NOT_FOUND" });
          const protectedBand = role.isAdmin || role.position <= rank.bestPosition || i <= rank.bestPosition;
          if (protectedBand && role.position !== i) {
            return reply.status(403).send({ error: "Cannot move roles equal to or above your own", code: "FORBIDDEN" });
          }
        }
      }

      await roleService.reorderRoles(params.spaceId, body.orderedIds);
      notifySpaceChanged(params.spaceId, "roles");
      return { data: { success: true } };
    },
  );

  // ── Channel overrides ──────────────────────────────────────

  /** GET /:spaceId/roles/:roleId/overrides — Get channel overrides (MANAGE_ROLES) */
  server.get<{ Params: { spaceId: string; roleId: string } }>(
    "/:spaceId/roles/:roleId/overrides",
    async (request, reply) => {
      const params = validate(spaceAndRoleIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      try {
        const overrides = await roleService.getChannelOverrides(params.spaceId, params.roleId);
        return { data: overrides };
      } catch (err: any) {
        return reply.status(404).send({ error: err.message, code: "NOT_FOUND" });
      }
    },
  );

  /** PUT /:spaceId/roles/:roleId/overrides — Set channel overrides */
  server.put<{
    Params: { spaceId: string; roleId: string };
    Body: { overrides: Array<{ channelId: string; allow: string[]; deny: string[] }> };
  }>(
    "/:spaceId/roles/:roleId/overrides",
    async (request, reply) => {
      const params = validate(spaceAndRoleIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(overridesBodySchema, request.body, reply);
      if (!body) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      const target = await requireRoleInSpace(params.spaceId, params.roleId, reply);
      if (!target) return;
      const rank = await getActorRank(params.spaceId, pubkey);
      if (!canManageRole(rank, target)) {
        return reply.status(403).send({ error: "Cannot override a role equal to or above your own", code: "FORBIDDEN" });
      }

      try {
        await roleService.setChannelOverrides(params.spaceId, params.roleId, body.overrides);
        notifySpaceChanged(params.spaceId, "roles");
        return { data: { success: true } };
      } catch (err: any) {
        return reply.status(404).send({ error: err.message, code: "NOT_FOUND" });
      }
    },
  );

  // ── Member roles ───────────────────────────────────────────

  /** GET /:spaceId/member-roles — Bulk fetch all members with roles */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/member-roles",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      if (!(await gateSpaceRead(request, reply, params.spaceId, "member-roles"))) return;
      const members = await roleService.getAllMembersWithRoles(params.spaceId);

      // Inline cached profiles for the first PROFILE_JOIN_CAP rows (facepiles);
      // rows beyond the cap keep profile: null. Enrichment stays at the route
      // layer so roleService remains pure.
      const profiles = await profileCacheService.getBatchProfiles(
        members.slice(0, PROFILE_JOIN_CAP).map((m) => m.pubkey),
      );
      const byPubkey = new Map(profiles.map((p) => [p.pubkey, p]));
      return {
        data: members.map((m, i) => ({
          ...m,
          profile: i < PROFILE_JOIN_CAP ? toMemberProfile(byPubkey.get(m.pubkey)) : null,
        })),
      };
    },
  );

  /** GET /:spaceId/members/:pubkey/roles — Get member roles */
  server.get<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/members/:pubkey/roles",
    async (request, reply) => {
      const params = validate(spaceAndPubkeyParamsSchema, request.params, reply);
      if (!params) return;

      if (!(await gateSpaceRead(request, reply, params.spaceId, "member-roles"))) return;
      const roles = await roleService.getMemberRoles(params.spaceId, params.pubkey);
      return { data: roles };
    },
  );

  /** POST /:spaceId/members/:pubkey/roles — Assign role */
  server.post<{
    Params: { spaceId: string; pubkey: string };
    Body: { roleId: string };
  }>(
    "/:spaceId/members/:pubkey/roles",
    async (request, reply) => {
      const params = validate(spaceAndPubkeyParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(assignRoleBodySchema, request.body, reply);
      if (!body) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      // The role must belong to this space (a foreign id would otherwise be
      // inserted as-is). Hierarchy: the creator outranks every role; anyone
      // else may only hand out non-admin roles strictly below their own best
      // role — so an Admin gives out everything below Admin, and only the
      // creator mints admins, wherever the Admin role sits in the order.
      const assignedRole = await requireRoleInSpace(params.spaceId, body.roleId, reply);
      if (!assignedRole) return;
      const rank = await getActorRank(params.spaceId, authPubkey);
      if (!canManageRole(rank, assignedRole)) {
        return reply.status(403).send({ error: "Cannot assign a role equal to or above your own", code: "FORBIDDEN" });
      }

      await roleService.assignRole(params.spaceId, params.pubkey, body.roleId);
      notifySpaceChanged(params.spaceId, "members");
      return { data: { success: true } };
    },
  );

  /** DELETE /:spaceId/members/:pubkey/roles/:roleId — Remove role */
  server.delete<{ Params: { spaceId: string; pubkey: string; roleId: string } }>(
    "/:spaceId/members/:pubkey/roles/:roleId",
    async (request, reply) => {
      const params = validate(spaceRolePubkeyParamsSchema, request.params, reply);
      if (!params) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      // Same hierarchy as assign, mirrored: a foreign role id is
      // a 404, the creator's roles can only be touched by the creator, and a
      // non-creator can only strip roles strictly below their own best role —
      // so two Admins can't demote each other and nobody demotes the owner.
      const allRoles = await roleService.listRoles(params.spaceId);
      const removedRole = allRoles.find((r) => r.id === params.roleId);
      if (!removedRole) return reply.status(404).send({ error: "Role not found", code: "NOT_FOUND" });

      const actorIsCreator = await isSpaceCreator(params.spaceId, authPubkey);
      if (!actorIsCreator) {
        if (await isSpaceCreator(params.spaceId, params.pubkey)) {
          return reply.status(403).send({ error: "Cannot change the space creator's roles", code: "FORBIDDEN" });
        }
        const actorRoles = await roleService.getMemberRoles(params.spaceId, authPubkey);
        const actorBestPos = Math.min(...actorRoles.map((r) => r.position));
        if (removedRole.position <= actorBestPos) {
          return reply.status(403).send({ error: "Cannot remove a role equal to or above your own", code: "FORBIDDEN" });
        }
      }

      await roleService.removeRoleFromMember(params.spaceId, params.pubkey, params.roleId);
      notifySpaceChanged(params.spaceId, "members");
      return { data: { success: true } };
    },
  );

  // ── Seed defaults ───────────────────────────────────────────

  /** POST /:spaceId/roles/seed — Seed default roles (called on space creation) */
  server.post<{ Params: { spaceId: string } }>(
    "/:spaceId/roles/seed",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = requirePubkey(request, reply);
      if (!pubkey) return;

      // Creator-only: seeding assigns the Admin role, so a stranger must never
      // reach it on a space they don't own (#0 sibling path).
      if (!(await requireSpaceCreator(params.spaceId, pubkey, reply))) return;

      // Only seed if no roles exist yet
      const existing = await roleService.listRoles(params.spaceId);
      if (existing.length > 0) {
        return { data: existing };
      }
      await roleService.seedDefaultRoles(params.spaceId, pubkey);
      const roles = await roleService.listRoles(params.spaceId);
      return { data: roles };
    },
  );

  // ── My permissions ─────────────────────────────────────────

  /** GET /:spaceId/permissions/me — Get my effective permissions */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/permissions/me",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const permissions = await roleService.getEffectivePermissions(params.spaceId, pubkey);
      return { data: permissions };
    },
  );

  /** GET /:spaceId/permissions/me/channels — Get permissions + channel overrides (batch) */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/permissions/me/channels",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const result = await roleService.getEffectiveChannelPermissions(params.spaceId, pubkey);
      return { data: result };
    },
  );
};
