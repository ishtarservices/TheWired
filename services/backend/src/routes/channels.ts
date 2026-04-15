import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString, nonNegativeInt } from "../lib/validation.js";
import { channelService } from "../services/channelService.js";
import { permissionService } from "../services/permissionService.js";

const spaceIdParams = z.object({ spaceId: nonEmptyString });

const createChannelBody = z.object({
  type: nonEmptyString,
  label: nonEmptyString,
  categoryId: z.string().optional(),
  adminOnly: z.boolean().optional(),
  slowModeSeconds: nonNegativeInt.optional(),
  feedMode: z.enum(["all", "curated"]).optional(),
});

const channelParams = z.object({ spaceId: nonEmptyString, channelId: nonEmptyString });

const updateChannelBody = z.object({
  label: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  position: nonNegativeInt.optional(),
  adminOnly: z.boolean().optional(),
  slowModeSeconds: z.number().optional(),
  isDefault: z.boolean().optional(),
  feedMode: z.enum(["all", "curated"]).optional(),
});

const reorderBody = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export const channelsRoutes: FastifyPluginAsync = async (server) => {
  /** GET /:spaceId/channels — List channels.
   *  VIEW_CHANNEL filtering is handled client-side via channel overrides. */
  server.get<{ Params: { spaceId: string } }>(
    "/:spaceId/channels",
    async (request, reply) => {
      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;

      const channels = await channelService.listChannels(params.spaceId);
      return { data: channels };
    },
  );

  /** POST /:spaceId/channels — Create channel */
  server.post<{
    Params: { spaceId: string };
    Body: { type: string; label: string; categoryId?: string; adminOnly?: boolean; slowModeSeconds?: number };
  }>(
    "/:spaceId/channels",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(createChannelBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        const channel = await channelService.createChannel(params.spaceId, body);
        return { data: channel };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
      }
    },
  );

  /** PATCH /:spaceId/channels/:channelId — Update channel */
  server.patch<{
    Params: { spaceId: string; channelId: string };
    Body: { label?: string; categoryId?: string | null; position?: number; adminOnly?: boolean; slowModeSeconds?: number; isDefault?: boolean };
  }>(
    "/:spaceId/channels/:channelId",
    async (request, reply) => {
      const pubkey = (request as any).pubkey as string | undefined;
      if (!pubkey) return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });

      const params = validate(channelParams, request.params, reply);
      if (!params) return;
      const body = validate(updateChannelBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      const channel = await channelService.updateChannel(params.channelId, body);
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

      const params = validate(channelParams, request.params, reply);
      if (!params) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      try {
        await channelService.deleteChannel(params.channelId);
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

      const params = validate(spaceIdParams, request.params, reply);
      if (!params) return;
      const body = validate(reorderBody, request.body, reply);
      if (!body) return;

      const perm = await permissionService.check(params.spaceId, pubkey, "MANAGE_CHANNELS");
      if (!perm.allowed) return reply.status(403).send({ error: "Missing MANAGE_CHANNELS permission", code: "FORBIDDEN" });

      await channelService.reorderChannels(params.spaceId, body.orderedIds);
      return { data: { success: true } };
    },
  );
};
