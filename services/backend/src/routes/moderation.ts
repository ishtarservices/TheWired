import type { FastifyPluginAsync } from "fastify";
import { moderationService } from "../services/moderationService.js";
import { permissionService } from "../services/permissionService.js";

export const moderationRoutes: FastifyPluginAsync = async (server) => {
  // ── Bans ───────────────────────────────────────────────────

  /** GET /:spaceId/moderation/bans — List active bans */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/moderation/bans",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      const bansList = await moderationService.listBans(spaceId);
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
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      const ban = await moderationService.banMember(spaceId, {
        pubkey: request.body.pubkey,
        reason: request.body.reason,
        bannedBy: authPubkey,
        expiresAt: request.body.expiresAt,
      });
      return { data: ban };
    },
  );

  /** DELETE /:spaceId/moderation/bans/:pubkey — Unban */
  server.delete<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/moderation/bans/:pubkey",
    async (request, reply) => {
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, pubkey } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "BAN_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing BAN_MEMBERS permission", code: "FORBIDDEN" });

      await moderationService.unbanMember(spaceId, pubkey);
      return { data: { success: true } };
    },
  );

  // ── Mutes ──────────────────────────────────────────────────

  /** GET /:spaceId/moderation/mutes — List active mutes */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/moderation/mutes",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      const mutesList = await moderationService.listMutes(spaceId);
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
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      const mute = await moderationService.muteMember(spaceId, {
        pubkey: request.body.pubkey,
        mutedBy: authPubkey,
        durationSeconds: request.body.durationSeconds,
        channelId: request.body.channelId,
      });
      return { data: mute };
    },
  );

  /** DELETE /:spaceId/moderation/mutes/:muteId — Unmute */
  server.delete<{ Params: { spaceId: string; muteId: string } }>(
    "/:spaceId/moderation/mutes/:muteId",
    async (request, reply) => {
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, muteId } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "MUTE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });

      await moderationService.unmuteMember(muteId);
      return { data: { success: true } };
    },
  );

  // ── Kick ───────────────────────────────────────────────────

  /** POST /:spaceId/moderation/kick/:pubkey — Kick a member */
  server.post<{ Params: { spaceId: string; pubkey: string } }>(
    "/:spaceId/moderation/kick/:pubkey",
    async (request, reply) => {
      const authPubkey = (request as any).pubkey as string | undefined;
      if (!authPubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, pubkey } = request.params;
      const perm = await permissionService.check(spaceId, authPubkey, "MANAGE_MEMBERS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_MEMBERS permission", code: "FORBIDDEN" });

      await moderationService.kickMember(spaceId, pubkey);
      return { data: { success: true } };
    },
  );
};
