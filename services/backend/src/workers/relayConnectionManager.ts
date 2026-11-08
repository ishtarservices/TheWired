import { config } from "../config.js";
import { db } from "../db/connection.js";
import { spaceRelays } from "../db/schema/relays.js";
import { spaces } from "../db/schema/spaces.js";
import { getRedis } from "../lib/redis.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { processEvent, type NostrEvent } from "./ingestHandlers.js";
import { checkDialTarget, type RelayUrlCheck } from "../lib/relayUrlGuard.js";

/**
 * Multi-relay ingestion manager (Decentralized Spaces, M3).
 *
 * Maintains one outbound WebSocket per distinct relay:
 *  - our own platform relay (config.relayUrl) — subscribed to ALL kinds exactly
 *    as the single-relay ingester always was (behavior-preserving: when no
 *    external relays are registered this is the *only* connection and acts
 *    identically to before);
 *  - each external relay listed in `app.space_relays` (status=approved, for a
 *    space whose ingestion_tier <> 'none') — subscribed ONLY to the chat +
 *    metadata of the spaces registered to it (collapsed into one connection).
 *
 * Trust: external connections carry an `allowedSpaceIds` set so a relay can only
 * affect spaces registered to it, and global kinds (profiles/music/zaps) and
 * app.space_members writes are accepted from the own relay only (ingestHandlers).
 */

const RECONNECT_MAX_MS = 60_000;

/** Largest frame accepted from an EXTERNAL relay (Node's built-in WebSocket
 *  has no maxPayload, so the cap is applied on receipt and the socket closed).
 *  Nostr events are a few KB; the relay's own limit is far below this. The own
 *  relay is exempt, like the rate cap. */
export const MAX_EXTERNAL_FRAME_BYTES = 1024 * 1024;

/** Close code sent when an external relay's frame is over the cap (private
 *  use range: the WHATWG close() refuses the standard 1009). */
export const FRAME_TOO_LARGE_CLOSE_CODE = 4009;

/** Largest NIP-11 document read from an external relay. */
export const MAX_NIP11_BYTES = 1024 * 1024;

function frameSize(data: unknown): number {
  if (typeof data === "string") return data.length;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data && typeof (data as { size?: unknown }).size === "number") return (data as { size: number }).size;
  return 0;
}

/**
 * The relay's NIP-11 document, for its signing key (39000/39002 trust). The
 * relay is attacker-registered: redirects are NOT followed (a 3xx to an
 * internal address would otherwise be fetched) and the body is capped.
 * Undefined on any failure — the key is optional.
 */
export async function fetchRelayPubkey(url: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    const res = await fetchImpl(httpUrl, {
      headers: { Accept: "application/nostr+json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const declared = Number(res.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > MAX_NIP11_BYTES) return undefined;
    const info = (await readJsonCapped(res, MAX_NIP11_BYTES)) as { pubkey?: unknown } | undefined;
    return typeof info?.pubkey === "string" ? info.pubkey : undefined;
  } catch {
    return undefined;
  }
}

/** `res.json()` with a running byte cap on the stream; undefined when over. */
async function readJsonCapped(res: Response, max: number): Promise<unknown> {
  const body = res.body;
  if (!body || typeof body.getReader !== "function") return res.json();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** NIP-59 gift wraps randomize created_at up to 2 days into the past, so the
 *  shared max-created_at `since` cursor would filter nearly all of them out.
 *  Their REQ looks back this far instead (2 days + slack); the replay this
 *  causes on every (re)connect is absorbed by the per-wrap dedupe in
 *  notificationEnqueue. */
export const WRAP_LOOKBACK_SEC = 2 * 24 * 3600 + 3600;

/** The ingest-role key as bytes, or null when unset/invalid. Accepts 64-hex or
 *  `nsec1…`. */
export function ingestSecretKeyBytes(raw: string = config.ingestSecretKey): Uint8Array | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    if (/^[0-9a-f]{64}$/i.test(v)) return hexToBytes(v.toLowerCase());
    if (v.startsWith("nsec1")) {
      const d = nip19.decode(v);
      if (d.type === "nsec") return d.data as Uint8Array;
    }
  } catch {
    // fall through
  }
  return null;
}

/** The ingest-role pubkey (hex) — the value to put in the relay's
 *  RELAY_INGEST_PUBKEYS. Null when no key is configured. */
export function ingestPubkey(): string | null {
  const sk = ingestSecretKeyBytes();
  return sk ? getPublicKey(sk) : null;
}

/** Sign the NIP-42 kind-22242 answer to `challenge`. The `relay` tag carries
 *  the relay's PUBLIC URL (what the relay's RELAY_URL names), not the internal
 *  address we dial. */
export function buildAuthEvent(challenge: string, sk: Uint8Array, relayUrl: string = config.publicRelayUrl): NostrEvent {
  return finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    },
    sk,
  ) as unknown as NostrEvent;
}

function wrapsReq(): string {
  return JSON.stringify([
    "REQ",
    "ingester-wraps",
    { kinds: [1059], since: Math.floor(Date.now() / 1000) - WRAP_LOOKBACK_SEC },
  ]);
}

/** Reports (kind 1984) are served only to their author and the ingest role
 *  (relay nostr/report_gate.rs), so like wraps they wait for the AUTH OK.
 *  They look back an hour past the shared cursor: a report published while the
 *  ingester was reconnecting must still reach the queue, and a replay is
 *  absorbed by app.reports.report_event_id being unique. */
export const REPORT_LOOKBACK_SEC = 3600;

function reportsReq(since: number): string {
  return JSON.stringify(["REQ", "ingester-reports", { kinds: [1984], since: since - REPORT_LOOKBACK_SEC }]);
}

/** The REQs the relay serves only to an authenticated ingest-role socket. */
const GATED_SUBS = new Set(["ingester-wraps", "ingester-reports"]);

/** Tunables (env-overridable so tests can shrink intervals/caps). */
function tunables() {
  return {
    reconnectBaseMs: Number(process.env.INGEST_RECONNECT_MS) || 5000,
    refreshIntervalMs: Number(process.env.INGEST_REFRESH_MS) || 60_000,
    /** Per-external-relay event cap per window before we drop the connection. */
    rateWindowMs: Number(process.env.INGEST_RATE_WINDOW_MS) || 10_000,
    rateMaxEvents: Number(process.env.INGEST_RATE_MAX) || 2000,
  };
}

interface Conn {
  ws: WebSocket | null;
  /** Space ids this external relay serves (empty/ignored for the own relay). */
  spaceIds: Set<string>;
  relayPubkey?: string;
  /** Own relay only: id of the kind-22242 AUTH we sent, until its OK lands. */
  pendingAuthId?: string;
  /** Own relay only: NIP-42 completed on this socket. */
  authed: boolean;
  /** Own relay only: the gated REQs (wraps, reports) wait for AUTH to
   *  complete — never sent yet, or CLOSED auth-required. */
  gatedPendingAuth: Set<string>;
  /** Own relay only: gated REQs already sent on this socket. */
  gatedSent: Set<string>;
  /** Own relay only: the cursor the reports REQ starts from. */
  reportsSince: number;
  /** `reportsSince` has been read for this socket. */
  sinceReady: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  /** External only: counts dial attempts, so a guard result that lands after
   *  the connection was closed or re-opened is ignored. */
  dialSeq: number;
  maxSeen: number;
  windowStart: number;
  windowCount: number;
}

export interface RelayIngesterOptions {
  /** Connect-time check run on every EXTERNAL relay URL right before it is
   *  dialled (default: checkDialTarget — resolve + refuse private addresses).
   *  Tests inject one; the own relay never goes through it. */
  dialGuard?: (url: string) => Promise<RelayUrlCheck>;
}

export function startRelayIngester(opts: RelayIngesterOptions = {}): { stop: () => Promise<void> } {
  const redis = getRedis();
  const cfg = tunables();
  const dialGuard = opts.dialGuard ?? checkDialTarget;
  const connections = new Map<string, Conn>();
  let stopped = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  // The reconcile in flight, if any: stop() waits for it so no query outlives
  // the manager, and a slow query doesn't stack another reconcile behind it.
  let refreshing: Promise<void> | null = null;

  const isOwn = (url: string) => url === config.relayUrl;

  function sinceKey(url: string): string {
    return isOwn(url)
      ? "ingester:last_seen" // preserve the original key for the platform relay
      : `ingester:last_seen:${Buffer.from(url).toString("base64url")}`;
  }
  async function getSince(url: string): Promise<number> {
    const v = await redis.get(sinceKey(url));
    return v ? parseInt(v, 10) : Math.floor(Date.now() / 1000) - 3600;
  }

  async function recordRelayError(url: string, message: string): Promise<void> {
    try {
      await db
        .update(spaceRelays)
        .set({ errorCount: sql`${spaceRelays.errorCount} + 1`, lastError: message })
        .where(eq(spaceRelays.relayUrl, url));
    } catch {
      // best-effort health bookkeeping
    }
  }

  function newConn(spaceIds: Set<string>): Conn {
    return {
      ws: null,
      spaceIds,
      reconnectTimer: null,
      backoffMs: cfg.reconnectBaseMs,
      dialSeq: 0,
      maxSeen: 0,
      windowStart: Date.now(),
      windowCount: 0,
      authed: false,
      gatedPendingAuth: new Set(),
      gatedSent: new Set(),
      reportsSince: 0,
      sinceReady: false,
    };
  }

  /** Returns false (and tears down the connection) if the relay is flooding us. */
  function rateOk(conn: Conn, url: string): boolean {
    if (isOwn(url)) return true; // never throttle our own relay
    const now = Date.now();
    if (now - conn.windowStart > cfg.rateWindowMs) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount += 1;
    if (conn.windowCount > cfg.rateMaxEvents) {
      void recordRelayError(url, "event rate cap exceeded");
      try {
        conn.ws?.close();
      } catch {
        /* ignore */
      }
      return false;
    }
    return true;
  }

  /** Arm one reconnect after the current backoff. `ws` is the socket (or
   *  null) the caller believes is current: a stale socket's close/error, or a
   *  guard result for a dial since superseded, arms nothing. */
  function scheduleReconnect(conn: Conn, url: string, ws: WebSocket | null): void {
    if (stopped || !connections.has(url) || conn.ws !== ws || conn.reconnectTimer) return;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      open(url);
    }, conn.backoffMs);
    conn.backoffMs = Math.min(conn.backoffMs * 2, RECONNECT_MAX_MS);
  }

  function open(url: string): void {
    if (stopped) return;
    const conn = connections.get(url);
    if (!conn) return;
    if (isOwn(url)) {
      dial(url, conn);
      return;
    }
    // External relay: the registry is attacker-influenced, so the target is
    // resolved and re-checked right before every connect (lib/relayUrlGuard
    // checkDialTarget — DNS rebinding). A refusal is treated like a failed
    // connect: recorded on the relay row and retried with backoff, since a
    // DNS answer can change either way.
    const attempt = ++conn.dialSeq;
    const current = conn.ws;
    void dialGuard(url).then(
      (check) => {
        if (stopped || connections.get(url) !== conn || conn.dialSeq !== attempt) return;
        if (!check.ok) {
          void recordRelayError(url, `dial refused: ${check.reason ?? "unsafe target"}`);
          scheduleReconnect(conn, url, current);
          return;
        }
        dial(url, conn);
      },
      () => {
        if (stopped || connections.get(url) !== conn || conn.dialSeq !== attempt) return;
        void recordRelayError(url, "dial refused: guard failed");
        scheduleReconnect(conn, url, current);
      },
    );
  }

  function dial(url: string, conn: Conn): void {
    const ws = new WebSocket(url);
    conn.ws = ws;

    ws.addEventListener("open", async () => {
      conn.backoffMs = cfg.reconnectBaseMs;
      conn.authed = false;
      conn.pendingAuthId = undefined;
      conn.sinceReady = false;
      conn.gatedSent.clear();
      // Armed BEFORE the first await: the relay sends its AUTH challenge on
      // connect, so the OK can land while getSince is still reading Redis. An
      // OK that found nothing armed used to strand the gated REQs (no wraps,
      // so no dm pushes) for the life of the socket.
      const gated = isOwn(url) && ingestSecretKeyBytes() !== null;
      conn.gatedPendingAuth = gated ? new Set(GATED_SUBS) : new Set();
      const since = await getSince(url);
      // Closed and redialled while the cursor was read: the new socket's own
      // open handler owns the connection state now.
      if (conn.ws !== ws) return;
      conn.reportsSince = since;
      conn.sinceReady = true;
      // One line per (re)connect: a relay restart that leaves the ingester
      // silently disconnected is visible as its absence.
      console.log(`[ingester] connected to ${isOwn(url) ? "own relay" : "relay"} ${url}`);

      if (isOwn(url)) {
        // Behavior-preserving: identical to the original single-relay ingester.
        // The space-scoped kinds here (9, 7, 9021, 9022) only arrive because the
        // relay grants the ingest role every space (ReadCtx::serve_all_spaces);
        // without the role this socket is a non-member and never sees them.
        ws.send(
          JSON.stringify([
            "REQ",
            "ingester",
            { kinds: [0, 1, 5, 7, 9, 22, 30023, 34236, 31683, 33123, 30119, 31685, 9735, 9021, 9022, 39000], since },
          ]),
        );
        ws.send(JSON.stringify(["REQ", "ingester-music-backfill", { kinds: [31683, 33123] }]));
        // 1059 (NIP-59 gift wraps) is ingested for ONE reason: a content-free
        // "new message" push to the `p` recipient. Never indexed. Separate REQ:
        // wraps backdate created_at, so the shared cursor would drop them.
        // 1984 (NIP-56 reports) go to the moderation queue (app.reports).
        // The relay serves both only to an authenticated ingest-role socket
        // (docs/DM_WIRE_CONTRACT.md §7.1–7.2, relay report_gate): with a key
        // configured the REQs wait for the AUTH OK (see the message handler)
        // — or go now if that OK already landed during the await above;
        // without one they are sent now (dev, or a relay whose gates are off).
        if (gated) {
          const sent = flushGated(conn, ws);
          if (sent.length > 0) console.log(`[ingester] sent gated REQs (${sent.join(", ")}) after AUTH`);
        } else {
          ws.send(wrapsReq());
          ws.send(reportsReq(since));
        }
        return;
      }

      // External relay: learn its signing key (for 39000/39002 trust) and
      // subscribe ONLY to the registered spaces' chat + metadata.
      if (conn.relayPubkey === undefined) conn.relayPubkey = await fetchRelayPubkey(url);
      const ids = [...conn.spaceIds];
      if (ids.length === 0) return;
      ws.send(JSON.stringify(["REQ", "ext-chat", { kinds: [9, 7], "#h": ids, since }]));
      ws.send(JSON.stringify(["REQ", "ext-meta", { kinds: [39000, 39002], "#d": ids }]));
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
      // No maxPayload on the built-in WebSocket: an external relay's oversize
      // frame is dropped unparsed and the socket closed. The WHATWG close()
      // only takes 1000 or 3000–4999 (1009 Message Too Big would throw), so a
      // private-use code carries the reason.
      if (!isOwn(url) && frameSize(ev.data) > MAX_EXTERNAL_FRAME_BYTES) {
        void recordRelayError(url, "frame over size cap");
        try {
          ws.close(FRAME_TOO_LARGE_CLOSE_CODE, "frame too large");
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        const msg = JSON.parse(String(ev.data));
        if (isOwn(url) && handleOwnRelayControl(conn, ws, msg)) return;
        if (msg[0] !== "EVENT" || !msg[2]) return;
        if (!rateOk(conn, url)) return;
        const event = msg[2] as NostrEvent;
        const ctx = {
          relayUrl: url,
          isOwnRelay: isOwn(url),
          allowedSpaceIds: isOwn(url) ? null : conn.spaceIds,
          relayPubkey: conn.relayPubkey,
        };
        processEvent(event, ctx).catch((err) => {
          console.error("[ingester] Error processing event:", (err as Error).message);
        });
        if (event.created_at > conn.maxSeen) {
          conn.maxSeen = event.created_at;
          void redis.set(sinceKey(url), String(event.created_at));
        }
      } catch {
        // ignore parse errors
      }
    });

    // Reconnect from BOTH close and error. Node's built-in (undici) WebSocket
    // fires only `error` — never `close` — when the connect itself is refused
    // (relay restarting, ECONNREFUSED), so a close-only reconnect gave up for
    // good the first time a retry landed while the relay was still down. The
    // guard in scheduleReconnect makes the pair idempotent when an established
    // socket errors and then closes.
    const reconnect = () => scheduleReconnect(conn, url, ws);
    ws.addEventListener("close", reconnect);
    ws.addEventListener("error", reconnect);
  }

  function sendGated(conn: Conn, ws: WebSocket, subId: string): void {
    ws.send(subId === "ingester-reports" ? reportsReq(conn.reportsSince) : wrapsReq());
    conn.gatedSent.add(subId);
  }

  /** Send the gated REQs that are waiting — plus any never sent on this
   *  socket, so an AUTH OK always yields them once — when AUTH has completed
   *  AND the reports cursor is known. Whichever of the two lands last sends.
   *  Returns the sub ids sent. */
  function flushGated(conn: Conn, ws: WebSocket): string[] {
    if (!conn.authed || !conn.sinceReady) return [];
    const sent: string[] = [];
    for (const subId of GATED_SUBS) {
      if (conn.gatedPendingAuth.delete(subId) || !conn.gatedSent.has(subId)) {
        sendGated(conn, ws, subId);
        sent.push(subId);
      }
    }
    return sent;
  }

  /** NIP-42 on the own relay: answer AUTH challenges with the ingest key,
   *  send the gated REQs (wraps, reports) once the AUTH is acknowledged, and
   *  re-send one when the relay CLOSED it as auth-required. Returns true when
   *  the frame was a control frame (not an EVENT). */
  function handleOwnRelayControl(conn: Conn, ws: WebSocket, msg: unknown[]): boolean {
    const type = msg[0];
    if (type === "AUTH" && typeof msg[1] === "string") {
      const sk = ingestSecretKeyBytes();
      if (!sk) return true;
      const auth = buildAuthEvent(msg[1], sk);
      conn.pendingAuthId = auth.id;
      ws.send(JSON.stringify(["AUTH", auth]));
      return true;
    }
    if (type === "OK" && typeof msg[1] === "string" && msg[1] === conn.pendingAuthId) {
      conn.pendingAuthId = undefined;
      if (msg[2] === true) {
        conn.authed = true;
        // The relay accepted the key — but only RELAY_INGEST_PUBKEYS makes it
        // the ingest ROLE; an unlisted key is an ordinary authed user and the
        // wraps/reports REQs below come back empty (relay logs a warning).
        const sent = flushGated(conn, ws);
        console.log(
          `[ingester] ingest AUTH accepted by ${config.relayUrl}; ` +
            (sent.length > 0 ? `sent gated REQs (${sent.join(", ")})` : "gated REQs follow once the cursor is read"),
        );
      } else {
        console.warn(`[ingester] relay rejected ingest AUTH: ${String(msg[3] ?? "")}`);
      }
      return true;
    }
    if (type === "CLOSED" && typeof msg[1] === "string" && GATED_SUBS.has(msg[1])) {
      const subId = msg[1];
      const reason = String(msg[2] ?? "");
      if (reason.startsWith("auth-required")) {
        // Sent before AUTH completed: retry after the OK (or immediately if
        // we are already authenticated on this socket).
        conn.gatedPendingAuth.add(subId);
        flushGated(conn, ws);
      } else {
        console.warn(`[ingester] ${subId} subscription closed: ${reason}`);
      }
      return true;
    }
    return type !== "EVENT";
  }

  function closeConnection(url: string): void {
    const conn = connections.get(url);
    if (!conn) return;
    connections.delete(url);
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
    try {
      conn.ws?.close();
    } catch {
      /* ignore */
    }
  }

  function setEq(a: Set<string>, b: Set<string>): boolean {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }

  /** Reconcile live connections against the registered, approved external relays. */
  async function refresh(): Promise<void> {
    if (stopped) return;
    let desired = new Map<string, Set<string>>();
    try {
      const rows = await db
        .select({ relayUrl: spaceRelays.relayUrl, spaceId: spaceRelays.spaceId })
        .from(spaceRelays)
        .innerJoin(spaces, eq(spaces.id, spaceRelays.spaceId))
        .where(and(eq(spaceRelays.status, "approved"), ne(spaces.ingestionTier, "none")));
      for (const r of rows) {
        if (isOwn(r.relayUrl)) continue; // own relay is managed separately
        const set = desired.get(r.relayUrl) ?? new Set<string>();
        set.add(r.spaceId);
        desired.set(r.relayUrl, set);
      }
    } catch (err) {
      console.error("[ingester] refresh query failed:", (err as Error).message);
      return;
    }
    // Stopped while the query ran: open nothing.
    if (stopped) return;

    // Enforce the global cap on distinct external relays.
    if (desired.size > config.maxIngestRelays) {
      desired = new Map([...desired].slice(0, config.maxIngestRelays));
      console.warn(`[ingester] capped external relays at ${config.maxIngestRelays}`);
    }

    // Close connections no longer desired.
    for (const url of connections.keys()) {
      if (isOwn(url)) continue;
      if (!desired.has(url)) closeConnection(url);
    }

    // Open new / re-subscribe changed.
    for (const [url, ids] of desired) {
      const existing = connections.get(url);
      if (!existing) {
        connections.set(url, newConn(ids));
        open(url);
      } else if (!setEq(existing.spaceIds, ids)) {
        existing.spaceIds = ids;
        // NIP-01 has no edit-REQ; bounce the socket to re-subscribe with the new set.
        try {
          existing.ws?.close();
        } catch {
          /* reconnect handles it */
        }
      }
    }
  }

  // Always connect the own relay first (unchanged single-relay behavior).
  const ingestPk = ingestPubkey();
  if (ingestPk) {
    console.log(`[ingester] NIP-42 ingest role enabled (pubkey ${ingestPk.slice(0, 12)}…)`);
  } else if (config.ingestSecretKey) {
    console.warn("[ingester] INGEST_SECRET_KEY is set but not a valid hex/nsec key — wraps REQ will be unauthenticated");
  }
  connections.set(config.relayUrl, newConn(new Set()));
  open(config.relayUrl);
  // Then reconcile external relays now and on an interval.
  const scheduleRefresh = () => {
    if (refreshing) return;
    refreshing = refresh().finally(() => {
      refreshing = null;
    });
  };
  scheduleRefresh();
  refreshTimer = setInterval(scheduleRefresh, cfg.refreshIntervalMs);

  return {
    stop: async () => {
      stopped = true;
      if (refreshTimer) clearInterval(refreshTimer);
      for (const url of [...connections.keys()]) closeConnection(url);
      await refreshing;
      console.log("[ingester] Stopped");
    },
  };
}
