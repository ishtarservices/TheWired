import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { permissionService } from "../services/permissionService.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const checkQuery = z.object({
  spaceId: nonEmptyString,
  pubkey: hexId,
  permission: nonEmptyString,
  channelId: z.string().optional(),
});

export const permissionsRoutes: FastifyPluginAsync = async (server) => {
  server.get("/check", async (request, reply) => {
    const callerPubkey = (request as any).pubkey as string | undefined;
    if (!callerPubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED", statusCode: 401 });
    }

    const query = validate(checkQuery, request.query, reply);
    if (!query) return;

    const result = await permissionService.check(query.spaceId, query.pubkey, query.permission, query.channelId);
    return { data: result };
  });
};
