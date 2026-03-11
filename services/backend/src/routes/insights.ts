import type { FastifyPluginAsync } from "fastify";
import { musicService } from "../services/musicService.js";

export const insightsRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/insights/* -- insights for a track/album by addressable ID
  server.get<{ Params: { "*": string } }>(
    "/insights/*",
    async (request) => {
      const addressableId = request.params["*"];
      const insights = await musicService.getInsights(addressableId);
      return { data: insights };
    },
  );

  // GET /music/insights-summary -- artist summary (auth required)
  server.get("/insights-summary", async (request, reply) => {
    const pubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }
    const summary = await musicService.getArtistSummary(pubkey);
    return { data: summary };
  });
};
