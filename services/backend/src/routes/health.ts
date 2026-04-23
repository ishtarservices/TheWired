import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { config } from "../config.js";

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get("/health", async () => {
    const base = { status: "ok" as const, service: "backend", timestamp: Date.now() };
    if (!config.transcodeEnqueue && !config.transcodeWorker) return base;

    try {
      const rows = (await db.execute(
        sql`SELECT transcode_status, COUNT(*)::int AS count
            FROM app.music_uploads
            GROUP BY transcode_status`,
      )) as unknown as { transcode_status: string; count: number }[];
      const transcode = Object.fromEntries(
        rows.map((r) => [r.transcode_status, r.count]),
      );
      return { ...base, transcode };
    } catch {
      return base;
    }
  });
};
