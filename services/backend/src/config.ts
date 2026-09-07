export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
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
  livekitUrl: process.env.LIVEKIT_URL ?? "ws://localhost:7880",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
  gifApiKey: process.env.GIF_API_KEY ?? "",
  gifClientKey: process.env.GIF_CLIENT_KEY ?? "thewired_v1",
  /** Comma-separated hex pubkeys that can approve/reject listing requests and bypass thresholds */
  adminPubkeys: (process.env.ADMIN_PUBKEYS ?? "").split(",").filter(Boolean),
  /** Minimum member count for a space to request listing (admin bypass available) */
  minListingMembers: parseInt(process.env.MIN_LISTING_MEMBERS ?? "5", 10),
  /** Decentralized Spaces ingestion (M3): how a newly-registered relay is handled.
   *  'approval' = pending until an admin approves; 'open' = auto-approve; 'closed' = none. */
  relayRegistrationMode: (process.env.RELAY_REGISTRATION_MODE ?? "approval") as
    | "open"
    | "approval"
    | "closed",
  /** Hard cap on distinct external relays the ingestion manager will dial. */
  maxIngestRelays: parseInt(process.env.MAX_INGEST_RELAYS ?? "50", 10),
  /** Max relays a single space may register for ingestion. */
  maxRelaysPerSpace: parseInt(process.env.MAX_RELAYS_PER_SPACE ?? "3", 10),
  /** Cloudflare credentials for provisioning per-user *named* relay tunnels
   *  (Decentralized Spaces, M7). When any is unset the named-tunnel endpoint
   *  returns 503 and only zero-config quick tunnels work. The token is
   *  backend-only and never sent to clients; scope it minimally
   *  (Account:Cloudflare Tunnel:Edit + Zone:DNS:Edit on the tunnel zone). */
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN ?? "",
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
  /** DNS zone under which each user's relay gets a stable subdomain
   *  (`<id>.relay.thewired.app`). Must live inside CLOUDFLARE_ZONE_ID. */
  tunnelHostnameZone: process.env.TUNNEL_HOSTNAME_ZONE ?? "relay.thewired.app",
  /** HMAC secret for minting/verifying media capability tokens (private-track
   *  playback via `?tk=`). Required in production — minting throws if empty and
   *  NODE_ENV=production; a deterministic dev fallback is used otherwise. */
  mediaTokenSecret: process.env.MEDIA_TOKEN_SECRET ?? "",
  /** Blossom blob storage directory */
  blobDir: process.env.BLOB_DIR ?? "blobs",
  /** Max blob upload size in bytes (default 100MB) */
  maxBlobSize: parseInt(process.env.MAX_BLOB_SIZE ?? String(100 * 1024 * 1024), 10),
  /** Public web origin used in share links and OG canonical URLs. */
  webBaseUrl: process.env.WEB_BASE_URL ?? "https://thewired.app",
  /** Where the share pages send people who don't have the app yet. The
   *  store links are empty until the soot listings exist — the landing
   *  page's download section is the fallback for every platform. */
  iosAppUrl: process.env.IOS_APP_URL ?? "",
  androidAppUrl: process.env.ANDROID_APP_URL ?? "",
  desktopAppUrl: process.env.DESKTOP_APP_URL ?? "",
  /** Apple appIDs (TEAMID.bundleid, comma-separated) for the universal-links
   *  apple-app-site-association served at thewired.app/.well-known/. The default
   *  is the soot mobile app's release identity. */
  appleAppIds: (process.env.APPLE_APP_IDS ?? "53RG2QV7HT.app.soot.mobile")
    .split(",")
    .filter(Boolean),
  /** Android package name for /.well-known/assetlinks.json. */
  androidPackageName: process.env.ANDROID_PACKAGE_NAME ?? "app.soot.mobile",
  /** Android release-cert SHA-256 fingerprints (colon-hex, comma-separated) for
   *  assetlinks.json. Empty (e.g. before EAS credentials are pulled) serves an
   *  empty statement list — app links stay off until this is set. */
  androidCertSha256: (process.env.ANDROID_CERT_SHA256 ?? "").split(",").filter(Boolean),
  /** When true, uploaded audio blobs are enqueued for transcoding. */
  transcodeEnqueue: process.env.TRANSCODE_ENQUEUE === "true",
  /** When true, this process runs the BullMQ transcoding consumer. */
  transcodeWorker: process.env.TRANSCODE_WORKER === "true",
  /** Max concurrent ffmpeg jobs per worker process. Default 1 keeps a vCPU free for API serving. */
  transcodeConcurrency: parseInt(process.env.TRANSCODE_CONCURRENCY ?? "1", 10),
} as const;
