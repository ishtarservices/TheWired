import { createServer } from "./server.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { initIndexes } from "./lib/meilisearch.js";
import { startRelayIngester } from "./workers/relayIngester.js";
import { startTrendingComputer } from "./workers/trendingComputer.js";
import { startProfileRefresher } from "./workers/profileRefresher.js";
import { startNotificationDispatcher } from "./workers/notificationDispatcher.js";
import { startAnalyticsAggregator } from "./workers/analyticsAggregator.js";
import { startDiscoveryScoreComputer } from "./workers/discoveryScoreComputer.js";
import { startTranscodeWorker } from "./workers/transcodeWorker.js";
import { closeTranscodeQueue } from "./lib/queue.js";
import { musicService } from "./services/musicService.js";

async function main() {
  // Run database migrations before anything else
  await runMigrations();

  const server = await createServer();

  await server.listen({ port: config.port, host: "0.0.0.0" });
  server.log.info(`Backend listening on port ${config.port}`);

  // Initialize Meilisearch indexes
  await initIndexes().catch((err) => {
    console.warn("[meilisearch] Failed to initialize indexes:", err.message);
  });

  // Reindex music from relay DB → Meilisearch + Redis on startup.
  // This ensures Meilisearch stays in sync even after restarts/crashes.
  musicService.rebuildCounts().then((r) => {
    console.log(`[music] Reindexed: ${r.tracksAndAlbums} tracks+albums, ${r.genres} genres, ${r.tags} tags`);
  }).catch((err) => {
    console.warn("[music] Reindex failed:", err.message);
  });

  // Start background workers
  const workers: Array<{ stop: () => void | Promise<void> }> = [
    startRelayIngester(),
    startTrendingComputer(),
    startProfileRefresher(),
    startNotificationDispatcher(),
    startAnalyticsAggregator(),
    startDiscoveryScoreComputer(),
  ];

  // BullMQ transcode worker is opt-in via env so we can scale producers and
  // consumers independently. Flag off by default; flip `TRANSCODE_WORKER=true`
  // to enable.
  if (config.transcodeWorker) {
    workers.push(startTranscodeWorker());
    console.log(`[transcode] worker started (concurrency=${config.transcodeConcurrency})`);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} received, shutting down...`);

    // Stop all workers — await any that return promises so BullMQ drains in-flight jobs
    for (const worker of workers) {
      await worker.stop();
    }

    // Close the transcode queue connection (harmless no-op if never opened)
    await closeTranscodeQueue().catch(() => {});

    // Close Fastify server (drains in-flight requests)
    try {
      await server.close();
      console.log("[shutdown] Server closed");
    } catch (err) {
      console.error("[shutdown] Error closing server:", err);
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
