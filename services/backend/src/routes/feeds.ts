import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { feedService } from "../services/feedService.js";
import { validate, limitParam, positiveInt } from "../lib/validation.js";

const trendingQuery = z.object({
  period: z.enum(["1h", "6h", "24h", "7d"]).optional(),
  kind: z.coerce.number().int().optional(),
  limit: limitParam(50, 200),
  genre: z.string().optional(),
});

const personalizedQuery = z.object({
  page: positiveInt().default(1),
  pageSize: positiveInt(100).default(20),
});

export const feedsRoutes: FastifyPluginAsync = async (server) => {
  server.get("/trending", async (request, reply) => {
    const query = validate(trendingQuery, request.query, reply);
    if (!query) return;

    const results = await feedService.getTrending({
      period: query.period ?? "24h",
      kind: query.kind,
      limit: query.limit,
      genre: query.genre,
    });
    return { data: results };
  });

  server.get("/personalized", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const query = validate(personalizedQuery, request.query, reply);
    if (!query) return;

    const results = await feedService.getPersonalized(pubkey, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return { data: results };
  });
};
