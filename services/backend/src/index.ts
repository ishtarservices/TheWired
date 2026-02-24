import { createServer } from "./server.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { initIndexes } from "./lib/meilisearch.js";
import { startRelayIngester } from "./workers/relayIngester.js";
import { startTrendingComputer } from "./workers/trendingComputer.js";
import { startProfileRefresher } from "./workers/profileRefresher.js";
import { startNotificationDispatcher } from "./workers/notificationDispatcher.js";
import { startAnalyticsAggregator } from "./workers/analyticsAggregator.js";

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

  // Start background workers
  startRelayIngester();
  startTrendingComputer();
  startProfileRefresher();
  startNotificationDispatcher();
  startAnalyticsAggregator();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
