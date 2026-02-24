import type { FastifyPluginAsync } from "fastify";
import { analyticsService } from "../services/analyticsService.js";

export const analyticsRoutes: FastifyPluginAsync = async (server) => {
  server.get<{ Params: { id: string } }>("/spaces/:id", async (request) => {
    const { id } = request.params;
    const { period } = request.query as { period?: string };
    const analytics = await analyticsService.getSpaceAnalytics(id, period ?? "7d");
    return { data: analytics };
  });
};
