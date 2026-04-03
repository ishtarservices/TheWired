import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { searchService } from "../services/searchService.js";
import { validate, nonEmptyString, limitParam } from "../lib/validation.js";

const searchQuery = z.object({
  q: nonEmptyString,
  kind: z.coerce.number().int().optional(),
  limit: limitParam(20, 100),
});

const musicSearchQuery = z.object({
  q: nonEmptyString,
  type: z.enum(["track", "album"]).optional(),
  limit: limitParam(20, 100),
  genre: z.string().optional(),
});

export const searchRoutes: FastifyPluginAsync = async (server) => {
  server.get("/", async (request, reply) => {
    const query = validate(searchQuery, request.query, reply);
    if (!query) return;

    const results = await searchService.search(query.q, {
      kind: query.kind,
      limit: query.limit,
    });
    return { data: results };
  });

  server.get("/music", async (request, reply) => {
    const query = validate(musicSearchQuery, request.query, reply);
    if (!query) return;

    const results = await searchService.searchMusic(query.q, {
      type: query.type,
      genre: query.genre,
      limit: query.limit,
    });
    return { data: results };
  });
};
