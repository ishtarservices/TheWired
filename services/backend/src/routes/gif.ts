import type { FastifyInstance } from "fastify";
import {
  getTrendingGifs,
  searchGifs,
  getAutocomplete,
  registerShare,
} from "../services/gifService.js";

export async function gifRoutes(app: FastifyInstance) {
  /** GET /gif/trending -- Fetch trending GIFs */
  app.get<{
    Querystring: { limit?: string; pos?: string };
  }>("/trending", async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit ?? "20", 10) || 20, 50);
    const pos = request.query.pos || undefined;

    try {
      const result = await getTrendingGifs(limit, pos);
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
    const { q } = request.query;
    if (!q || !q.trim()) {
      return reply.status(400).send({ error: "Missing query parameter 'q'", code: "BAD_REQUEST" });
    }

    const limit = Math.min(parseInt(request.query.limit ?? "20", 10) || 20, 50);
    const pos = request.query.pos || undefined;

    try {
      const result = await searchGifs(q.trim(), limit, pos);
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
    const { q } = request.query;
    if (!q || !q.trim()) {
      return reply.status(400).send({ error: "Missing query parameter 'q'", code: "BAD_REQUEST" });
    }

    try {
      const results = await getAutocomplete(q.trim());
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
    const { id, searchTerm } = request.body ?? {};
    if (!id) {
      return reply.status(400).send({ error: "Missing 'id' in body", code: "BAD_REQUEST" });
    }

    await registerShare(id, searchTerm);
    return reply.status(204).send();
  });
}
