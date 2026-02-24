import type { FastifyPluginAsync } from "fastify";
import { feedService } from "../services/feedService.js";

export const feedsRoutes: FastifyPluginAsync = async (server) => {
  server.get("/trending", async (request) => {
    const { period, kind, limit } = request.query as {
      period?: string;
      kind?: string;
      limit?: string;
    };
    const results = await feedService.getTrending({
      period: (period as "1h" | "6h" | "24h" | "7d") ?? "24h",
      kind: kind ? parseInt(kind) : undefined,
      limit: limit ? parseInt(limit) : 50,
    });
    return { data: results };
  });

  server.get("/personalized", async (request) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const { page, pageSize } = request.query as { page?: string; pageSize?: string };
    const results = await feedService.getPersonalized(pubkey, {
      page: page ? parseInt(page) : 1,
      pageSize: pageSize ? parseInt(pageSize) : 20,
    });
    return { data: results };
  });
};
