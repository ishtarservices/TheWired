import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { moderationService } from "../services/moderationService.js";
import { permissionService } from "../services/permissionService.js";
import { validate, hexId, nonEmptyString, positiveInt } from "../lib/validation.js";

const spaceIdParamsSchema = z.object({
  spaceId: nonEmptyString,
});

const spaceAndPubkeyParamsSchema = z.object({
  spaceId: nonEmptyString,
  pubkey: hexId,
});

const spaceAndMuteIdParamsSchema = z.object({
  spaceId: nonEmptyString,
  muteId: nonEmptyString,
});

const banBodySchema = z.object({
  pubkey: hexId,
  reason: z.string().optional(),
  expiresAt: z.number().optional(),
});

const muteBodySchema = z.object({
  pubkey: hexId,
  durationSeconds: positiveInt(),
  channelId: z.string().optional(),
});

export const moderationRoutes: FastifyPluginAsync = async (server) => {
  // ── Bans ───────────────────────────────────────────────────

  /** GET /:spaceId/moderation/bans — List active bans */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/moderation/bans",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      const bansList = await moderationService.listBans(params.spaceId);
      return { data: bansList };
    },
  );

  /** POST /:spaceId/moderation/bans — Ban a member */
  server.post<{
    Params: { spaceId: string };
    Body: { pubkey: string; reason?: string; expiresAt?: number };
  }>(
    "/:spaceId/moderation/bans",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(banBodySchema, request.body, reply);
      if (!body) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      // Hierarchy check: actor must outrank target
      const hierarchy = await permissionService.checkHierarchy(params.spaceId, authPubkey, body.pubkey);
      if (!hierarchy.allowed) return reply.status(403).send({ error: hierarchy.reason, code: "FORBIDDEN" });

      const ban = await moderationService.banMember(params.spaceId, {
        pubkey: body.pubkey,
        reason: body.reason,
        bannedBy: authPubkey,
        expiresAt: body.expiresAt,
      });
      return { data: ban };
    },
  );

  /** DELETE /:spaceId/moderation/bans/:pubkey — Unban */
  server.delete<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/moderation/bans/:pubkey",
    async (request, reply) => {
      const params = validate(spaceAndPubkeyParamsSchema, request.params, reply);
      if (!params) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      await moderationService.unbanMember(params.spaceId, params.pubkey, authPubkey);
      return { data: { success: true } };
    },
  );

  // ── Mutes ──────────────────────────────────────────────────

  /** GET /:spaceId/moderation/mutes — List active mutes */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/moderation/mutes",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, pubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      const mutesList = await moderationService.listMutes(params.spaceId);
      return { data: mutesList };
    },
  );

  /** POST /:spaceId/moderation/mutes — Mute a member */
  server.post<{
    Params: { spaceId: string };
    Body: { pubkey: string; durationSeconds: number; channelId?: string };
  }>(
    "/:spaceId/moderation/mutes",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;
      const body = validate(muteBodySchema, request.body, reply);
      if (!body) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      // Hierarchy check: actor must outrank target
      const hierarchy = await permissionService.checkHierarchy(params.spaceId, authPubkey, body.pubkey);
      if (!hierarchy.allowed) return reply.status(403).send({ error: hierarchy.reason, code: "FORBIDDEN" });

      const mute = await moderationService.muteMember(params.spaceId, {
        pubkey: body.pubkey,
        mutedBy: authPubkey,
        durationSeconds: body.durationSeconds,
        channelId: body.channelId,
      });
      return { data: mute };
    },
  );

  /** DELETE /:spaceId/moderation/mutes/:muteId — Unmute */
  server.delete<{ Params: { spaceId: string; muteId: string } }>(
    "/:spaceId/moderation/mutes/:muteId",
    async (request, reply) => {
      const params = validate(spaceAndMuteIdParamsSchema, request.params, reply);
      if (!params) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      await moderationService.unmuteMember(params.muteId);
      return { data: { success: true } };
    },
  );

  // ── Kick ───────────────────────────────────────────────────

  /** POST /:spaceId/moderation/kick/:pubkey — Kick a member */
  server.post<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/moderation/kick/:pubkey",
    async (request, reply) => {
      const params = validate(spaceAndPubkeyParamsSchema, request.params, reply);
      if (!params) return;

      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const perm = await permissionService.check(params.spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      // Hierarchy check: actor must outrank target
      const hierarchy = await permissionService.checkHierarchy(params.spaceId, authPubkey, params.pubkey);
      if (!hierarchy.allowed) return reply.status(403).send({ error: hierarchy.reason, code: "FORBIDDEN" });

      await moderationService.kickMember(params.spaceId, params.pubkey, authPubkey);
      return { data: { success: true } };
    },
  );

  // ── Audit Log ───────────────────────────────────────────────

  /** GET /:spaceId/moderation/audit-log — List recent audit log entries */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/moderation/audit-log",
    async (request, reply) => {
      const params = validate(spaceIdParamsSchema, request.params, reply);
      if (!params) return;

      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      // Require BAN_MEMBERS or MANAGE_MEMBERS to view audit log
      const perm = await permissionService.check(params.spaceId, pubkey, "BAN_MEMBERS");
      const perm2 = await permissionService.check(params.spaceId, pubkey, "MANAGE_MEMBERS");
      if (!perm.allowed && !perm2.allowed) {
        return reply.status(403).send({ error: "Missing permission", code: "FORBIDDEN" });
      }

      const entries = await moderationService.listAuditLog(params.spaceId);
      return { data: entries };
    },
  );
};
