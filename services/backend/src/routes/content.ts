import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { contentService } from "../services/contentService.js";
import { permissionService } from "../services/permissionService.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const contentParams = z.object({
  id: nonEmptyString,
});

const pinBody = z.object({
  eventId: hexId,
  channelId: nonEmptyString,
});

const scheduleBody = z.object({
  content: nonEmptyString,
  channelId: nonEmptyString,
  scheduledAt: z.number().positive(),
  kind: z.number().optional(),
});

export const contentRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Params: { id: string } }>("/spaces/:id/pin", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const params = validate(contentParams, request.params, reply);
    if (!params) return;
    const body = validate(pinBody, request.body, reply);
    if (!body) return;

    const perm = await permissionService.check(params.id, pubkey, "PIN_MESSAGES", body.channelId);
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    await contentService.pinMessage(params.id, body.channelId, body.eventId, pubkey);
    return { data: { success: true } };
  });

  server.post<{ Params: { id: string } }>("/spaces/:id/schedule", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const params = validate(contentParams, request.params, reply);
    if (!params) return;
    const body = validate(scheduleBody, request.body, reply);
    if (!body) return;

    const perm = await permissionService.check(params.id, pubkey, "MANAGE_MESSAGES", body.channelId);
    if (!perm.allowed) {
      return reply.status(403).send({ error: perm.reason ?? "Forbidden", code: "FORBIDDEN" });
    }

    await contentService.scheduleMessage(params.id, body.channelId, body.content, body.scheduledAt, pubkey, body.kind);
    return { data: { success: true } };
  });
};
