export const config = {
  port: parseInt(process.env.PORT ?? "3002", 10),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://thewired:thewired@localhost:5432/thewired",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  meilisearchUrl: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
  meilisearchKey: process.env.MEILISEARCH_KEY ?? "thewired_dev_key",
  relayUrl: process.env.RELAY_URL ?? "ws://localhost:7777",
  logLevel: process.env.LOG_LEVEL ?? "info",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@thewired.app",
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:9080",
} as const;
