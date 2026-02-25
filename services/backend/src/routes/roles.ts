import type { FastifyPluginAsync } from "fastify";
import { roleService } from "../services/roleService.js";
import { permissionService } from "../services/permissionService.js";

export const rolesRoutes: FastifyPluginAsync = async (server) => {
  // ── Roles CRUD ──────────────────────────────────────────────

  /** GET /:spaceId/roles — List roles */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/roles",
    async (request) => {
      const { spaceId } = request.params;
      const roles = await roleService.listRoles(spaceId);
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
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      const role = await roleService.createRole(spaceId, request.body);
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
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, roleId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      const role = await roleService.updateRole(roleId, request.body);
      return { data: role };
    },
  );

  /** DELETE /:spaceId/roles/:roleId — Delete role */
  server.delete<{ Params: { spaceId: string; roleId: string } }>(
    "/:spaceId/roles/:roleId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, roleId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      try {
        await roleService.deleteRole(roleId);
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
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      await roleService.reorderRoles(spaceId, request.body.orderedIds);
      return { data: { success: true } };
    },
  );

  // ── Channel overrides ──────────────────────────────────────

  /** GET /:spaceId/roles/:roleId/overrides — Get channel overrides */
  server.get<{ Params: { spaceId: string; roleId: string } }>(
    "/:spaceId/roles/:roleId/overrides",
    async (request) => {
      const { roleId } = request.params;
      const overrides = await roleService.getChannelOverrides(roleId);
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
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, roleId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_ROLES");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_ROLES permission", code: "FORBIDDEN" });

      await roleService.setChannelOverrides(roleId, request.body.overrides);
      return { data: { success: true } };
    },
  );

  // ── Member roles ───────────────────────────────────────────

  /** GET /:spaceId/members/:pubkey/roles — Get member roles */
  server.get<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/members/:pubkey/roles",
    async (request) => {
      const { spaceId, pubkey } = request.params;
      const roles = await roleService.getMemberRoles(spaceId, pubkey);
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
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, pubkey } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      await roleService.assignRole(spaceId, pubkey, request.body.roleId);
      return { data: { success: true } };
    },
  );

  /** DELETE /:spaceId/members/:pubkey/roles/:roleId — Remove role */
  server.delete<{ Params: { spaceId: string; pubkey: string; roleId: string } }>(
    "/:spaceId/members/:pubkey/roles/:roleId",
    async (request, reply) => {
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, pubkey, roleId } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      await roleService.removeRoleFromMember(spaceId, pubkey, roleId);
      return { data: { success: true } };
    },
  );

  // ── Seed defaults ───────────────────────────────────────────

  /** POST /:spaceId/roles/seed — Seed default roles (called on space creation) */
  server.post<{ Params: { spaceId: string } }>(
    "/:spaceId/roles/seed",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      // Only seed if no roles exist yet
      const existing = await roleService.listRoles(spaceId);
      if (existing.length > 0) {
        return { data: existing };
      }
      await roleService.seedDefaultRoles(spaceId, pubkey);
      const roles = await roleService.listRoles(spaceId);
      return { data: roles };
    },
  );

  // ── My permissions ─────────────────────────────────────────

  /** GET /:spaceId/permissions/me — Get my effective permissions */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/permissions/me",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const permissions = await roleService.getEffectivePermissions(spaceId, pubkey);
      return { data: permissions };
    },
  );
};
