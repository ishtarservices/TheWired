import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";
import { getMeilisearchClient } from "../lib/meilisearch.js";

/** Per-dependency probe budget. Docker's healthcheck allows the request 5 s. */
const CHECK_TIMEOUT_MS = 2000;

type CheckStatus = "ok" | "down";

/** "ok" if the probe settles within the budget, "down" on error or timeout.
 *  ioredis queues commands while reconnecting, so a dead Redis would hang a
 *  bare `ping()` rather than reject; the timeout is what reports it. */
async function check(probe: () => Promise<unknown>): Promise<CheckStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([probe(), timeout]);
    return "ok";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync = async (server) => {
  // Readiness, not just liveness: any dependency down makes this a 503, so the
  // container healthcheck (and `docker compose ps`) shows it instead of a
  // crash-looping search engine hiding behind an always-ok answer. Nothing
  // gates on backend health (the proxy waits on the gateway, whose /health is
  // static), so a 503 here only reports; it never takes the API down.
  server.get("/health", async (_request, reply) => {
    const [postgres, redis, meilisearch] = await Promise.all([
      check(() => db.execute(sql`SELECT 1`)),
      check(() => getRedis().ping()),
      check(() => getMeilisearchClient().health()),
    ]);
    const checks = { postgres, redis, meilisearch };
    const healthy = Object.values(checks).every((s) => s === "ok");
    if (!healthy) reply.code(503);

    const base = {
      status: healthy ? ("ok" as const) : ("degraded" as const),
      service: "backend",
      timestamp: Date.now(),
      checks,
    };
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
