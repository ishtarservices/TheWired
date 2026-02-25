import type { FastifyPluginAsync } from "fastify";
import { channelService } from "../services/channelService.js";
import { permissionService } from "../services/permissionService.js";

export const channelsRoutes: FastifyPluginAsync = async (server) => {
  /** GET /:spaceId/channels — List channels */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/channels",
    async (request) => {
      const { spaceId } = request.params;
      const channels = await channelService.listChannels(spaceId);
      return { data: channels };
    },
  );

  /** POST /:spaceId/channels — Create channel */
  server.post<{
    Params: { spaceId: string };
    Body: { type: string; label: string; adminOnly?: boolean; slowModeSeconds?: number };
  }>(
    "/:spaceId/channels",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        const channel = await channelService.createChannel(spaceId, request.body);
        return { data: channel };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
      }
    },
  );

  /** PATCH /:spaceId/channels/:channelId — Update channel */
  server.patch<{
    Params: { spaceId: string; channelId: string };
    Body: { label?: string; position?: number; adminOnly?: boolean; slowModeSeconds?: number };
  }>(
    "/:spaceId/channels/:channelId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, channelId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      const channel = await channelService.updateChannel(channelId, request.body);
      if (!channel) return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
      return { data: channel };
    },
  );

  /** DELETE /:spaceId/channels/:channelId — Delete channel */
  server.delete<{ Params: { spaceId: string; channelId: string } }>(
    "/:spaceId/channels/:channelId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId, channelId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        await channelService.deleteChannel(channelId);
        return { data: { success: true } };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
      }
    },
  );

  /** POST /:spaceId/channels/reorder — Reorder channels */
  server.post<{
    Params: { spaceId: string };
    Body: { orderedIds: string[] };
  }>(
    "/:spaceId/channels/reorder",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const { spaceId } = request.params;
      const perm = await permissionService.check(spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      await channelService.reorderChannels(spaceId, request.body.orderedIds);
      return { data: { success: true } };
    },
  );
};
