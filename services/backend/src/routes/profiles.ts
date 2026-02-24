import type { FastifyPluginAsync } from "fastify";
import { profileCacheService } from "../services/profileCacheService.js";

export const profilesRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { pubkey: string } }>("/:pubkey", async (request) => {
    const { pubkey } = request.params;
    const profile = await profileCacheService.getProfile(pubkey);
    if (!profile) {
      return { error: "Profile not found", code: "NOT_FOUND", statusCode: 404 };
    }
    return { data: profile };
  });

  server.post("/batch", async (request) => {
    const { pubkeys } = request.body as { pubkeys: string[] };
    const profiles = await profileCacheService.getBatchProfiles(pubkeys);
    return { data: profiles };
  });
};
