import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { validate, nonEmptyString } from "../lib/validation.js";
import { musicService } from "../services/musicService.js";
import {
  fetchLatestByAddressableId,
  checkEventVisibility,
} from "../services/musicVisibility.js";

const wildcardParams = z.object({ "*": nonEmptyString });

export const insightsRoutes: FastifyPluginAsync = async (server) => {
  // GET /music/insights/* -- insights for a track/album by addressable ID.
  // Public events serve openly; private/space events require the same viewer
  // authorization as /music/resolve (play counts are metadata too).
  server.get<{ Params: { "*": string } }>(
    "/insights/*",
    async (request, reply) => {
      const params = validate(wildcardParams, request.params, reply);
      if (!params) return;

      const addressableId = params["*"];

      const event = await fetchLatestByAddressableId(addressableId);
      if (event) {
        const authPubkey = (request.headers["x-auth-pubkey"] as string) ?? null;
        const allowed = await checkEventVisibility(event, event.pubkey, authPubkey, reply);
        if (!allowed) return;
      }

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
