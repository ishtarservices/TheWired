import type { FastifyPluginAsync } from "fastify";
import { searchService } from "../services/searchService.js";

export const searchRoutes: FastifyPluginAsync = async (server) => {
  server.get("/", async (request) => {
    const { q, kind, limit } = request.query as {
      q: string;
      kind?: string;
      limit?: string;
    };
    const results = await searchService.search(q, {
      kind: kind ? parseInt(kind) : undefined,
      limit: limit ? parseInt(limit) : 20,
    });
    return { data: results };
  });

  server.get("/music", async (request) => {
    const { q, type, limit } = request.query as {
      q: string;
      type?: "track" | "album";
      limit?: string;
    };
    const results = await searchService.searchMusic(q, {
      type,
      limit: limit ? parseInt(limit) : 20,
    });
    return { data: results };
  });
};
