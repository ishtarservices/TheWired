import { config } from "../config.js";
import { db } from "../db/connection.js";
import { spaceRelays } from "../db/schema/relays.js";
import { spaces } from "../db/schema/spaces.js";
import { getRedis } from "../lib/redis.js";
import { and, eq, ne, sql } from "drizzle-orm";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { processEvent, type NostrEvent } from "./ingestHandlers.js";

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
  /** Own relay only: the wraps REQ was CLOSED auth-required and must be re-sent
   *  once AUTH completes. */
  wrapsPendingAuth: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  maxSeen: number;
  windowStart: number;
  windowCount: number;
}

export function startRelayIngester(): { stop: () => void } {
  const redis = getRedis();
  const cfg = tunables();
  const connections = new Map<string, Conn>();
  let stopped = false;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

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

  async function fetchRelayPubkey(url: string): Promise<string | undefined> {
    try {
      const httpUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
      const res = await fetch(httpUrl, {
        headers: { Accept: "application/nostr+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return undefined;
      const info = (await res.json()) as { pubkey?: unknown };
      return typeof info?.pubkey === "string" ? info.pubkey : undefined;
    } catch {
      return undefined;
    }
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
      maxSeen: 0,
      windowStart: Date.now(),
      windowCount: 0,
      authed: false,
      wrapsPendingAuth: false,
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

  function open(url: string): void {
    if (stopped) return;
    const conn = connections.get(url);
    if (!conn) return;

    const ws = new WebSocket(url);
    conn.ws = ws;

    ws.addEventListener("open", async () => {
      conn.backoffMs = cfg.reconnectBaseMs;
      conn.authed = false;
      conn.pendingAuthId = undefined;
      conn.wrapsPendingAuth = false;
      const since = await getSince(url);

      if (isOwn(url)) {
        // Behavior-preserving: identical to the original single-relay ingester.
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
        // The relay serves wraps only to an authenticated ingest-role socket
        // (docs/DM_WIRE_CONTRACT.md §7.1–7.2): with a key configured the REQ
        // waits for the AUTH OK (see the message handler); without one it is
        // sent now (dev, or a relay whose gate is off/warn).
        if (ingestSecretKeyBytes()) {
          conn.wrapsPendingAuth = true;
        } else {
          ws.send(wrapsReq());
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

    ws.addEventListener("close", () => {
      if (stopped || !connections.has(url)) return;
      conn.reconnectTimer = setTimeout(() => open(url), conn.backoffMs);
      conn.backoffMs = Math.min(conn.backoffMs * 2, RECONNECT_MAX_MS);
    });

    ws.addEventListener("error", () => {
      // close handler will schedule the reconnect
    });
  }

  /** NIP-42 on the own relay: answer AUTH challenges with the ingest key,
   *  send the wraps REQ once the AUTH is acknowledged, and re-send it when
   *  the relay CLOSED it as auth-required. Returns true when the frame was a
   *  control frame (not an EVENT). */
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
        if (conn.wrapsPendingAuth) {
          conn.wrapsPendingAuth = false;
          ws.send(wrapsReq());
        }
      } else {
        console.warn(`[ingester] relay rejected ingest AUTH: ${String(msg[3] ?? "")}`);
      }
      return true;
    }
    if (type === "CLOSED" && msg[1] === "ingester-wraps") {
      const reason = String(msg[2] ?? "");
      if (reason.startsWith("auth-required")) {
        // Sent before AUTH completed: retry after the OK (or immediately if
        // we are already authenticated on this socket).
        if (conn.authed) ws.send(wrapsReq());
        else conn.wrapsPendingAuth = true;
      } else {
        console.warn(`[ingester] wraps subscription closed: ${reason}`);
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
  void refresh();
  refreshTimer = setInterval(() => void refresh(), cfg.refreshIntervalMs);

  return {
    stop: () => {
      stopped = true;
      if (refreshTimer) clearInterval(refreshTimer);
      for (const url of [...connections.keys()]) closeConnection(url);
      console.log("[ingester] Stopped");
    },
  };
}
