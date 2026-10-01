import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { profileCacheService } from "../services/profileCacheService.js";
import { validate, hexId } from "../lib/validation.js";
import { suspensionService } from "../services/suspensionService.js";

const pubkeyParams = z.object({
  pubkey: hexId,
});

const batchBody = z.object({
  pubkeys: z.array(hexId).min(1).max(50),
});

export const profilesRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { pubkey: string } }>("/:pubkey", async (request, reply) => {
    const params = validate(pubkeyParams, request.params, reply);
    if (!params) return;

    // A suspended account is hidden from API responses (suspend_pubkey).
    const profile = (await suspensionService.isSuspended(params.pubkey))
      ? null
      : await profileCacheService.getProfile(params.pubkey);
    if (!profile) {
      return reply.status(404).send({ error: "Profile not found", code: "NOT_FOUND", statusCode: 404 });
    }
    return { data: profile };
  });

  server.post("/batch", async (request, reply) => {
    const body = validate(batchBody, request.body, reply);
    if (!body) return;

    const profiles = await suspensionService.withoutSuspended(
      await profileCacheService.getBatchProfiles(body.pubkeys),
      (p) => p.pubkey,
    );
    return { data: profiles };
  });
};
