import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  getTrendingGifs,
  searchGifs,
  getAutocomplete,
  registerShare,
} from "../services/gifService.js";
import { validate, nonEmptyString, limitParam } from "../lib/validation.js";

const trendingQuerySchema = z.object({
  limit: limitParam(20, 50),
  pos: z.string().optional(),
});

const searchQuerySchema = z.object({
  q: nonEmptyString,
  limit: limitParam(20, 50),
  pos: z.string().optional(),
});

const autocompleteQuerySchema = z.object({
  q: nonEmptyString,
});

const registerShareBodySchema = z.object({
  id: nonEmptyString,
  searchTerm: z.string().optional(),
});

export async function gifRoutes(app: FastifyInstance) {
  /** GET /gif/trending -- Fetch trending GIFs */
  app.get<{
    Querystring: { limit?: string; pos?: string };
  }>("/trending", async (request, reply) => {
    const query = validate(trendingQuerySchema, request.query, reply);
    if (!query) return;

    try {
      const result = await getTrendingGifs(query.limit, query.pos);
      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "GIF fetch failed";
      request.log.error({ err }, "GIF trending fetch failed");
      return reply.status(502).send({ error: message, code: "GIF_API_ERROR" });
    }
  });

  /** GET /gif/search -- Search GIFs by query */
  app.get<{
    Querystring: { q: string; limit?: string; pos?: string };
  }>("/search", async (request, reply) => {
    const query = validate(searchQuerySchema, request.query, reply);
    if (!query) return;

    try {
      const result = await searchGifs(query.q, query.limit, query.pos);
      return reply.send({ data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "GIF search failed";
      request.log.error({ err }, "GIF search failed");
      return reply.status(502).send({ error: message, code: "GIF_API_ERROR" });
    }
  });

  /** GET /gif/autocomplete -- Get search suggestions */
  app.get<{
    Querystring: { q: string };
  }>("/autocomplete", async (request, reply) => {
    const query = validate(autocompleteQuerySchema, request.query, reply);
    if (!query) return;

    try {
      const results = await getAutocomplete(query.q);
      return reply.send({ data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "GIF autocomplete failed";
      request.log.error({ err }, "GIF autocomplete failed");
      return reply.status(502).send({ error: message, code: "GIF_API_ERROR" });
    }
  });

  /** POST /gif/register-share -- Record a share event (API TOS) */
  app.post<{
    Body: { id: string; searchTerm?: string };
  }>("/register-share", async (request, reply) => {
    const body = validate(registerShareBodySchema, request.body, reply);
    if (!body) return;

    await registerShare(body.id, body.searchTerm);
    return reply.status(204).send();
  });
}
