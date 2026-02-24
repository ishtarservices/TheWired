import type { FastifyPluginAsync } from "fastify";
import { contentService } from "../services/contentService.js";
import { permissionService } from "../services/permissionService.js";

export const contentRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Params: { id: string } }>("/spaces/:id/pin", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const { id } = request.params;
    const { eventId, channelId } = request.body as { eventId: string; channelId: string };

    const perm = await permissionService.check(id, pubkey, "PIN_MESSAGES", channelId);
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    await contentService.pinMessage(id, channelId, eventId, pubkey);
    return { data: { success: true } };
  });

  server.post<{ Params: { id: string } }>("/spaces/:id/schedule", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const { id } = request.params;
    const { content, channelId, scheduledAt, kind } = request.body as {
      content: string;
      channelId: string;
      scheduledAt: number;
      kind?: number;
    };

    const perm = await permissionService.check(id, pubkey, "MANAGE_MESSAGES", channelId);
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    await contentService.scheduleMessage(id, channelId, content, scheduledAt, pubkey, kind);
    return { data: { success: true } };
  });
};
