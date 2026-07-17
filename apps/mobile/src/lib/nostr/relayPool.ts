// ─── Minimal mobile relay pool ───────────────────────────────────────
// Deliberately small (guide 08 Phase 1): connect/subscribe/publish/EOSE,
// exponential backoff, per-relay status — over the WebSocketFactory adapter.
// This is NOT the desktop relayManager; that arrives with @thewired/core at
// Phase 0. Mobile-specific edges the desktop doesn't have:
//   • suspend()/resume() — iOS kills sockets on background; the lifecycle
//     controller suspends proactively and resumes with fresh filters.
//   • 3-socket discipline — battery (guide 06 §3); callers pass a fixed set.
// Backoff constants ported from client/src/lib/nostr/{reconnect,constants}.

import type { ClientMessage, NostrEvent, NostrFilter, RelayMessage } from "@thewired/shared-types";

import type { WebSocketFactory, WebSocketLike } from "@/core/adapters";
import type { RelayStatus } from "@/store/slices/relaysSlice";

const BACKOFF = { BASE_DELAY: 1000, MAX_DELAY: 60_000, JITTER: 0.25 } as const;
const WS_OPEN = 1;

/** Compute backoff delay with jitter (desktop computeBackoff). */
export function computeBackoff(attempt: number): number {
  const exponential = Math.min(
    BACKOFF.BASE_DELAY * Math.pow(2, attempt),
    BACKOFF.MAX_DELAY,
  );
  const jitter = exponential * BACKOFF.JITTER * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

export interface RelayPoolCallbacks {
  onEvent(subId: string, event: NostrEvent, relayUrl: string): void;
  onEose(subId: string, relayUrl: string): void;
  onStatus(url: string, status: RelayStatus): void;
  /** OK frames — publish acknowledgements. */
  onOk?(eventId: string, accepted: boolean, message: string, relayUrl: string): void;
  /** NIP-42 challenge — respond via auth() when a signer is available. */
  onAuth?(challenge: string, relayUrl: string): void;
}

export interface RelayPool {
  /** Open sockets to this relay set (idempotent; extra relays are dropped). */
  connect(urls: string[]): void;
  /** Track + send a REQ (re-sent automatically on reconnect). Re-subscribing
   *  with an existing id replaces its filters. `relayUrls` scopes the REQ to
   *  those relays only (exact match against connect() urls) — used for subs
   *  whose events must come from a trusted relay (e.g. membership-gated
   *  kind-9: public relays don't enforce #h, so a broadcast REQ would let
   *  anyone spoof rows). Omitted = all relays, unchanged behavior. */
  subscribe(subId: string, filters: NostrFilter[], relayUrls?: string[]): void;
  unsubscribe(subId: string): void;
  /** Send EVENT to every open relay; queued per-relay while connecting. */
  publish(event: NostrEvent): void;
  /** NIP-42: send a signed kind-22242 AUTH response (to one relay, or all). */
  auth(event: NostrEvent, relayUrl?: string): void;
  /** Background: close sockets + cancel timers; subscriptions stay
   *  registered for resume(). */
  suspend(): void;
  /** Foreground: reopen sockets; REQs re-send on open. */
  resume(): void;
  /** Connectivity returned: skip remaining backoff, reconnect now. */
  reconnectNow(): void;
  destroy(): void;
}

interface RelayConn {
  url: string;
  ws: WebSocketLike | null;
  status: RelayStatus;
  attempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  queue: ClientMessage[];
}

export function createRelayPool(
  wsFactory: WebSocketFactory,
  callbacks: RelayPoolCallbacks,
): RelayPool {
  interface SubEntry {
    filters: NostrFilter[];
    /** Undefined = every relay; otherwise only these (exact url match). */
    urls?: string[];
  }

  const conns = new Map<string, RelayConn>();
  const subscriptions = new Map<string, SubEntry>();
  let suspended = false;
  let destroyed = false;

  function subTargets(entry: SubEntry, url: string): boolean {
    return !entry.urls || entry.urls.includes(url);
  }

  function setStatus(conn: RelayConn, status: RelayStatus): void {
    if (conn.status === status) return;
    conn.status = status;
    callbacks.onStatus(conn.url, status);
  }

  function send(conn: RelayConn, msg: ClientMessage): void {
    if (conn.ws && conn.ws.readyState === WS_OPEN) {
      conn.ws.send(JSON.stringify(msg));
    } else {
      conn.queue.push(msg);
    }
  }

  function clearReconnect(conn: RelayConn): void {
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
  }

  function scheduleReconnect(conn: RelayConn): void {
    if (suspended || destroyed) return;
    clearReconnect(conn);
    const delay = computeBackoff(conn.attempts);
    conn.attempts++;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      openSocket(conn);
    }, delay);
  }

  function handleMessage(conn: RelayConn, raw: unknown): void {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(String(raw)) as RelayMessage;
    } catch {
      return; // malformed frame
    }
    switch (msg[0]) {
      case "EVENT":
        callbacks.onEvent(msg[1], msg[2], conn.url);
        break;
      case "EOSE":
        callbacks.onEose(msg[1], conn.url);
        break;
      case "OK":
        callbacks.onOk?.(msg[1], msg[2], msg[3] ?? "", conn.url);
        break;
      case "CLOSED":
        // Server closed a sub. The minimal pool doesn't retry these — the
        // desktop cap/deferral machinery arrives with the core (Phase 0).
        if (msg[2]) {
          console.warn(`[pool] ${conn.url} CLOSED ${msg[1]}: ${msg[2]}`);
        }
        break;
      case "NOTICE":
        console.warn(`[pool] ${conn.url} NOTICE: ${msg[1]}`);
        break;
      case "AUTH":
        // NIP-42 challenge (the platform relay gates group-chat reads).
        callbacks.onAuth?.(msg[1], conn.url);
        break;
    }
  }

  function openSocket(conn: RelayConn): void {
    if (suspended || destroyed) return;
    if (conn.ws && conn.ws.readyState === WS_OPEN) return;
    setStatus(conn, "connecting");

    let ws: WebSocketLike;
    try {
      ws = wsFactory.create(conn.url);
    } catch {
      setStatus(conn, "error");
      scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      conn.attempts = 0;
      // Re-send tracked REQs first, then any queued messages (publishes).
      for (const [subId, entry] of subscriptions) {
        if (!subTargets(entry, conn.url)) continue;
        ws.send(JSON.stringify(["REQ", subId, ...entry.filters]));
      }
      const queued = conn.queue;
      conn.queue = [];
      for (const msg of queued) {
        // Drop stale REQ/CLOSE — the registry replay above is authoritative.
        if (msg[0] === "EVENT") ws.send(JSON.stringify(msg));
      }
      setStatus(conn, "connected");
    };

    ws.onmessage = (event) => handleMessage(conn, event.data);

    ws.onerror = () => {
      setStatus(conn, "error");
    };

    ws.onclose = () => {
      conn.ws = null;
      if (suspended || destroyed) {
        setStatus(conn, "disconnected");
        return;
      }
      setStatus(conn, "disconnected");
      scheduleReconnect(conn);
    };
  }

  function closeSocket(conn: RelayConn): void {
    clearReconnect(conn);
    if (conn.ws) {
      // Detach first so the close handler doesn't schedule a reconnect.
      conn.ws.onclose = null;
      conn.ws.onmessage = null;
      conn.ws.onerror = null;
      conn.ws.onopen = null;
      try {
        conn.ws.close();
      } catch {
        // socket already dead (iOS killed it while suspended)
      }
      conn.ws = null;
    }
    setStatus(conn, "disconnected");
  }

  return {
    connect(urls: string[]): void {
      // Drop relays no longer in the set.
      for (const [url, conn] of conns) {
        if (!urls.includes(url)) {
          closeSocket(conn);
          conns.delete(url);
        }
      }
      for (const url of urls) {
        if (!conns.has(url)) {
          conns.set(url, {
            url,
            ws: null,
            status: "disconnected",
            attempts: 0,
            reconnectTimer: null,
            queue: [],
          });
        }
        openSocket(conns.get(url)!);
      }
    },

    subscribe(subId: string, filters: NostrFilter[], relayUrls?: string[]): void {
      const prev = subscriptions.get(subId);
      const entry: SubEntry = { filters, urls: relayUrls };
      subscriptions.set(subId, entry);
      for (const conn of conns.values()) {
        const open = conn.ws && conn.ws.readyState === WS_OPEN;
        if (subTargets(entry, conn.url)) {
          if (open) conn.ws!.send(JSON.stringify(["REQ", subId, ...filters]));
          // Not open → the registry replay on `onopen` covers it.
        } else if (prev && subTargets(prev, conn.url) && open) {
          // Retargeted away from this relay — close the stale server-side sub.
          conn.ws!.send(JSON.stringify(["CLOSE", subId]));
        }
      }
    },

    unsubscribe(subId: string): void {
      const entry = subscriptions.get(subId);
      if (!entry) return;
      subscriptions.delete(subId);
      for (const conn of conns.values()) {
        if (!subTargets(entry, conn.url)) continue;
        if (conn.ws && conn.ws.readyState === WS_OPEN) {
          conn.ws.send(JSON.stringify(["CLOSE", subId]));
        }
      }
    },

    publish(event: NostrEvent): void {
      for (const conn of conns.values()) {
        send(conn, ["EVENT", event]);
      }
    },

    auth(event: NostrEvent, relayUrl?: string): void {
      for (const conn of conns.values()) {
        if (relayUrl && conn.url !== relayUrl) continue;
        if (conn.ws && conn.ws.readyState === WS_OPEN) {
          conn.ws.send(JSON.stringify(["AUTH", event]));
        }
      }
    },

    suspend(): void {
      if (suspended) return;
      suspended = true;
      for (const conn of conns.values()) {
        closeSocket(conn);
      }
    },

    resume(): void {
      if (!suspended) return;
      suspended = false;
      for (const conn of conns.values()) {
        conn.attempts = 0;
        openSocket(conn);
      }
    },

    reconnectNow(): void {
      if (suspended || destroyed) return;
      for (const conn of conns.values()) {
        clearReconnect(conn);
        conn.attempts = 0;
        // Cycle EVERY socket — including readyState OPEN ones. After a
        // network change, iOS sockets routinely stay half-open: OPEN by
        // readyState but dead on the wire, never firing error/close. Any
        // socket predating the connectivity edge is untrustworthy; dialing
        // fresh is cheap (3 sockets) and tracked REQs replay on open.
        if (conn.ws) closeSocket(conn);
        openSocket(conn);
      }
    },

    destroy(): void {
      destroyed = true;
      for (const conn of conns.values()) {
        closeSocket(conn);
      }
      conns.clear();
      subscriptions.clear();
    },
  };
}
