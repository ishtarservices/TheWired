import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { roleService } from "../services/roleService.js";
import { permissionService } from "../services/permissionService.js";
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
  name: nonEmptyString,
  color: z.string().optional(),
  permissions: z.array(z.string()),
  isAdmin: z.boolean().optional(),
});

const updateRoleBodySchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

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

      const role = await roleService.createRole(params.spaceId, body);
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

      const role = await roleService.updateRole(params.roleId, body);
      return { data: role };
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

      try {
        await roleService.deleteRole(params.roleId);
        return { data: { success: true } };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
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

      await roleService.reorderRoles(params.spaceId, body.orderedIds);
      return { data: { success: true } };
    },
  );

  // ── Channel overrides ──────────────────────────────────────

  /** GET /:spaceId/roles/:roleId/overrides — Get channel overrides */
  server.get<{ Params: { spaceId: string; roleId: string } }>(
    "/:spaceId/roles/:roleId/overrides",
    async (request, reply) => {
      const params = validate(spaceAndRoleIdParamsSchema, request.params, reply);
      if (!params) return;

      const overrides = await roleService.getChannelOverrides(params.roleId);
      return { data: overrides };
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

      await roleService.setChannelOverrides(params.roleId, body.overrides);
      return { data: { success: true } };
    },
  );

  // ── Member roles ───────────────────────────────────────────

  /** GET /:spaceId/member-roles — Bulk fetch all members with roles */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/member-roles",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const members = await roleService.getAllMembersWithRoles(params.spaceId);
      return { data: members };
    },
  );

  /** GET /:spaceId/members/:pubkey/roles — Get member roles */
  server.get<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/members/:pubkey/roles",
    async (request, reply) => {
      const params = validate(spaceAndPubkeyParamsSchema, request.params, reply);
      if (!params) return;

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

      // Hierarchy: actor's highest role must outrank the role being assigned
      const actorRoles = await roleService.getMemberRoles(params.spaceId, authPubkey);
      const actorBestPos = Math.min(...actorRoles.map((r) => r.position));
      const allRoles = await roleService.listRoles(params.spaceId);
      const assignedRole = allRoles.find((r) => r.id === body.roleId);
      if (assignedRole && assignedRole.position <= actorBestPos) {
        return reply.status(403).send({ error: "Cannot assign a role equal to or above your own", code: "FORBIDDEN" });
      }

      await roleService.assignRole(params.spaceId, params.pubkey, body.roleId);
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

      await roleService.removeRoleFromMember(params.spaceId, params.pubkey, params.roleId);
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

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

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
