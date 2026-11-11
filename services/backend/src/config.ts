const nodeEnv = process.env.NODE_ENV ?? "development";
const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:9080";

/** BUD-11 `server` tag values this backend answers to: BLOSSOM_SERVER_NAMES
 *  (comma list) or the PUBLIC_URL hostname, plus the loopback names outside
 *  production. Lowercase hostnames, no port. */
function blossomServerNames(): string[] {
  const listed = (process.env.BLOSSOM_SERVER_NAMES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const names = listed.length > 0 ? listed : [new URL(publicUrl).hostname.toLowerCase()];
  if (nodeEnv !== "production") names.push("localhost", "127.0.0.1");
  return [...new Set(names)];
}

function spaceMediaGate(): "off" | "log" | "enforce" {
  const v = (process.env.SPACE_MEDIA_GATE ?? "log").trim().toLowerCase();
  return v === "off" || v === "enforce" ? v : "log";
}

/** A non-negative integer env value, else the default. */
function nonNegativeInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function spaceReadGate(): "off" | "log" | "enforce" {
  const v = (process.env.SPACE_READ_GATE ?? "log").trim().toLowerCase();
  return v === "off" || v === "enforce" ? v : "log";
}

function gatewayAuthMode(): "off" | "warn" | "enforce" {
  const v = (process.env.GATEWAY_AUTH_MODE ?? "off").trim().toLowerCase();
  return v === "warn" || v === "enforce" ? v : "off";
}

/** Fastify `trustProxy`: which upstream hops may set X-Forwarded-For (so
 *  `request.ip` is the client, not the proxy). `true` trusts every hop (only
 *  safe when the backend port is not reachable directly); `false` trusts none;
 *  otherwise a comma list of IPs/CIDRs/keywords (loopback, linklocal,
 *  uniquelocal). Default: loopback + the RFC1918 ranges Docker's bridge
 *  networks and the native dev stack use. */
function trustProxy(): boolean | string[] {
  const raw = (process.env.TRUST_PROXY ?? "").trim();
  if (raw === "") return ["loopback", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  port: parseInt(process.env.PORT ?? "3002", 10),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://thewired:thewired@localhost:5432/thewired",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
  meilisearchUrl: process.env.MEILISEARCH_URL ?? "http://localhost:7700",
  meilisearchKey: process.env.MEILISEARCH_KEY ?? "thewired_dev_key",
  relayUrl: process.env.RELAY_URL ?? "ws://localhost:7777",
  /** The relay's PUBLIC URL as clients dial it (and as the relay's own
   *  RELAY_URL names it) — goes into NIP-42 AUTH `relay` tags and DM push
   *  payloads. Defaults to RELAY_URL (identical in dev; differs behind Docker). */
  publicRelayUrl: process.env.PUBLIC_RELAY_URL ?? process.env.RELAY_URL ?? "ws://localhost:7777",
  /** Ingest-role secret key (64-hex or nsec). With it the ingester answers the
   *  relay's NIP-42 challenge so it can read kind-1059 gift wraps for the
   *  content-free DM push (docs/DM_WIRE_CONTRACT.md §7.2). Its pubkey must be
   *  listed in the relay's RELAY_INGEST_PUBKEYS. Empty = no AUTH (dev / gate off). */
  ingestSecretKey: process.env.INGEST_SECRET_KEY ?? "",
  logLevel: process.env.LOG_LEVEL ?? "info",
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "",
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? "",
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@thewired.app",
  /** Expo push service access token (optional; "enhanced push security"). */
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? "",
  publicUrl,
  livekitUrl: process.env.LIVEKIT_URL ?? "ws://localhost:7880",
  livekitApiKey: process.env.LIVEKIT_API_KEY ?? "devkey",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET ?? "secret",
  /** Voice/video rooms are frame-level end-to-end encrypted (docs/E2EE_CALLS.md).
   *  On by default: `/voice/token` and `/voice/dm-token` refuse a client that
   *  does not send `supportsE2EE: true` — a plaintext build in an encrypted
   *  room hears noise and is heard by nobody. Every client (desktop and
   *  mobile) must implement the media-key protocol; set to "false" only to
   *  bridge a rollout. */
  voiceRequireE2EE: process.env.VOICE_REQUIRE_E2EE !== "false",
  gifApiKey: process.env.GIF_API_KEY ?? "",
  gifClientKey: process.env.GIF_CLIENT_KEY ?? "thewired_v1",
  /** Comma-separated hex pubkeys of platform admins: approve/reject listing
   *  requests, bypass thresholds, review reports (`requireAdmin`), and receive
   *  the new-report push on every device they registered. */
  adminPubkeys: (process.env.ADMIN_PUBKEYS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** Discord/Slack-compatible incoming webhook POSTed on every new report —
   *  the written record, and the backup when admin push is off. Empty = off. */
  reportWebhookUrl: process.env.REPORT_WEBHOOK_URL ?? "",
  /** HMAC key for app.reports.reporter_ip_hash (guest reports). Falls back to
   *  MEDIA_TOKEN_SECRET so no new secret is required; the hash only has to be
   *  stable, not secret from the operator. */
  reportIpSalt: process.env.REPORT_IP_SALT || process.env.MEDIA_TOKEN_SECRET || "dev-report-ip-salt",
  /** Open reports one account may have at once (POST /reports answers 429
   *  past it; a kind 1984 is stored closed). 0 = unlimited. Guests are capped
   *  by the gateway per IP instead. */
  reportsMaxOpenPerReporter: nonNegativeInt(process.env.REPORTS_MAX_OPEN_PER_REPORTER, 10),
  /** Gateway-signed identity headers (gateway internal/gatewayauth). The
   *  gateway MACs X-Auth-Pubkey / X-Client-Ip with GATEWAY_SHARED_SECRET into
   *  X-Gateway-Auth; `mode` says what the backend does with it: off = trust
   *  the headers as before (default), warn = verify and log mismatches, enforce
   *  = drop the identity unless the MAC verifies. Roll out off → warn → enforce. */
  gatewayAuth: {
    secret: process.env.GATEWAY_SHARED_SECRET ?? "",
    mode: gatewayAuthMode(),
  },
  /** Which upstream hops may set X-Forwarded-For (see trustProxy()). */
  trustProxy: trustProxy(),
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
  /** Hostnames accepted in a kind-24242 `server` tag (see blossomServerNames). */
  blossomServerNames: blossomServerNames(),
  /** Read gate for space-scoped blobs (docs/MEDIA_STORAGE.md §4): `off` skips
   *  the scope check, `log` serves a would-be denial and logs it, `enforce`
   *  denies. Scope rows are recorded in every mode; the music gate is always
   *  enforced. */
  spaceMediaGate: spaceMediaGate(),
  /** Read gate for an unlisted space's roster, roles, channels, feed sources,
   *  onboarding and full row (lib/spaceReadGate.ts): `off` serves anyone, `log`
   *  serves a non-member and logs it, `enforce` answers 404 (and trims the
   *  public invite preview). */
  spaceReadGate: spaceReadGate(),
  /** Per-pubkey BUD-02 upload guard: uploads per minute, and bytes per UTC day. */
  uploadRatePerMin: parseInt(process.env.UPLOAD_RATE_PER_MIN ?? "30", 10),
  uploadDailyBytes: parseInt(process.env.UPLOAD_DAILY_BYTES ?? String(2 * 1024 * 1024 * 1024), 10),
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
