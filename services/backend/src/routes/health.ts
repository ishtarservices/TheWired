import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get("/health", async () => {
    return { status: "ok", service: "backend", timestamp: Date.now() };
  });
};
