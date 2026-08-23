import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { searchService } from "../services/searchService.js";
import { validate, nonEmptyString, limitParam, offsetParam } from "../lib/validation.js";

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

// `q` is optional here, unlike the other search routes: the q-less form is the
// default "people worth following" browse list, not a degenerate search.
const peopleSearchQuery = z.object({
  q: z.string().max(200).optional(),
  hasNip05: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  sort: z.string().max(50).optional(),
  limit: limitParam(30, 100),
  offset: offsetParam,
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

  // GET /search/people — search AND browse. Guest-readable (no NIP-98).
  server.get("/people", async (request, reply) => {
    const query = validate(peopleSearchQuery, request.query, reply);
    if (!query) return;

    const results = await searchService.searchPeople({
      q: query.q,
      hasNip05: query.hasNip05,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
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
