import type { NostrEvent, NostrFilter, UnsignedEvent } from "../../types/nostr";
import type { RelayMode } from "../../types/relay";
import type { RelayEventCallback, RelayEOSECallback, RelayOKCallback, RelayStatusCallback, SubscribeOptions, RelayConfig } from "./types";
import { RelayConnection } from "./relayConnection";
import { StormDetector } from "./reconnect";
import { BOOTSTRAP_RELAYS, INDEXER_RELAYS } from "./constants";
import { createLogger, shortRelay } from "../debug/logger";

const log = createLogger("sub");

/** Kinds the indexer-only relays (purplepag.es / user.kindpag.es) actually serve:
 *  metadata, contacts, relay list. They reject everything else and have strict
 *  concurrent-REQ caps, so we must never send them chat/engagement/note subs. */
const INDEXER_KINDS = new Set([0, 3, 10002]);

const INDEXER_SET = new Set<string>(INDEXER_RELAYS);

/** True if every filter is limited to indexer-served kinds (so it's safe to send
 *  to an indexer relay). A filter with no `kinds` matches everything → not safe.
 *  Exported so layers above (subscriptionManager) can mirror the same strip and
 *  not wait on EOSE from a relay that was never actually subscribed. */
export function isIndexerSafe(filters: NostrFilter[]): boolean {
  return filters.every((f) => f.kinds != null && f.kinds.every((k) => INDEXER_KINDS.has(k)));
}

/** Indexer-relay URL set (frozen — used by callers to mirror the strip). */
export const INDEXER_URL_SET = INDEXER_SET;

let subIdCounter = 0;
function nextSubId(): string {
  return `sub_${++subIdCounter}_${Date.now().toString(36)}`;
}

class RelayManagerImpl {
  private connections = new Map<string, RelayConnection>();
  private stormDetector = new StormDetector();
  private onEventCallbacks = new Map<string, RelayEventCallback>();
  private onEOSECallbacks = new Map<string, RelayEOSECallback>();
  private globalOnOK: RelayOKCallback | null = null;
  private globalOnStatusChange: RelayStatusCallback | null = null;

  /** Transient one-shot status listeners used by waitForConnection /
   *  connectToBootstrapAndWait. Additive (a Set) so concurrent waiters — e.g.
   *  two logins racing, or an account switch — don't clobber each other's
   *  callback the way overwriting a single field did. */
  private statusWaiters = new Set<RelayStatusCallback>();

  /** Tracks active subscriptions that targeted specific relay URLs.
   *  When a relay connects for the first time, pending subs are forwarded to it. */
  private pendingSubscriptions = new Map<string, {
    filters: NostrFilter[];
    intendedUrls: string[];
  }>();

  /** Per-event-id callbacks for publish confirmation (used by publishWithConfirmation) */
  private publishOKCallbacks = new Map<string, (relayUrl: string, success: boolean, message: string) => void>();

  /** Relays that have reached "connected" at least once this session — lets us
   *  tell a reconnect apart from a first connect. */
  private everConnected = new Set<string>();
  /** Listeners fired when a relay reconnects (connected after a prior connect). */
  private reconnectListeners = new Set<(relayUrl: string) => void>();

  setGlobalCallbacks(cbs: {
    onOK?: RelayOKCallback;
    onStatusChange?: RelayStatusCallback;
  }) {
    if (cbs.onOK) this.globalOnOK = cbs.onOK;
    if (cbs.onStatusChange) this.globalOnStatusChange = cbs.onStatusChange;
  }

  /** Register a listener fired when a relay reconnects (reaches "connected"
   *  after a previous connect this session). Returns an unsubscribe fn.
   *  Additive so multiple subsystems can listen without clobbering. */
  onReconnect(cb: (relayUrl: string) => void): () => void {
    this.reconnectListeners.add(cb);
    return () => this.reconnectListeners.delete(cb);
  }

  connect(url: string, mode: RelayMode = "read+write"): RelayConnection {
    const existing = this.connections.get(url);
    if (existing) {
      existing.connect();
      return existing;
    }

    const conn = new RelayConnection(url, mode, this.stormDetector);
    // Fetch NIP-11 relay info to learn subscription limits (non-blocking)
    this.fetchNip11(url, conn);
    conn.setCallbacks({
      onEvent: (subId, event, relayUrl) => {
        // Route to the specific subscription callback
        const cb = this.onEventCallbacks.get(subId);
        if (cb) {
          cb(event, relayUrl);
        }
      },
      onEOSE: (subId, relayUrl) => {
        this.onEOSECallbacks.get(subId)?.(subId, relayUrl);
      },
      onOK: (eventId, success, message, relayUrl) => {
        this.globalOnOK?.(eventId, success, message, relayUrl);
        this.publishOKCallbacks.get(eventId)?.(relayUrl, success, message);
      },
      onStatusChange: (relayUrl, status, error) => {
        this.globalOnStatusChange?.(relayUrl, status, error);
        for (const waiter of this.statusWaiters) waiter(relayUrl, status, error);
        if (status === "connected") {
          const isReconnect = this.everConnected.has(relayUrl);
          this.everConnected.add(relayUrl);
          this.forwardPendingSubscriptions(relayUrl, conn);
          // Fire reconnect listeners only on a genuine reconnect, not the first
          // connect (avoids needless bg-sub rebuilds during cold start).
          if (isReconnect) {
            for (const cb of this.reconnectListeners) cb(relayUrl);
          }
        }
      },
      onAuth: async (challenge: string, relayUrl: string): Promise<NostrEvent | null> => {
        // Lazy imports to avoid circular dependency
        const { getSigner } = await import("./loginFlow");
        const { store } = await import("../../store");
        const signer = getSigner();
        const pubkey = store.getState().identity.pubkey;
        // Silent: this is the expected state pre-login; replayAuth retries
        // once login completes.
        if (!signer || !pubkey) return null;
        const unsigned: UnsignedEvent = {
          pubkey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 22242,
          tags: [
            ["relay", relayUrl],
            ["challenge", challenge],
          ],
          content: "",
        };
        try {
          return await signer.signEvent(unsigned);
        } catch (err) {
          console.warn(`[auth] signEvent failed for ${relayUrl}`, err);
          return null;
        }
      },
    });
    this.connections.set(url, conn);
    conn.connect();
    return conn;
  }

  disconnect(url: string): void {
    const conn = this.connections.get(url);
    if (conn) {
      conn.disconnect();
      this.connections.delete(url);
    }
  }

  disconnectAll(): void {
    for (const [url] of this.connections) {
      this.disconnect(url);
    }
    this.pendingSubscriptions.clear();
    this.publishOKCallbacks.clear();
    this.everConnected.clear();
  }

  /** Publish an event to write relays. Returns the number of relays it was sent to. */
  publish(
    event: NostrEvent,
    targets?: string[],
  ): number {
    const relays = targets
      ? targets
          .map((url) => this.connections.get(url))
          .filter((c): c is RelayConnection => !!c)
      : this.getWriteRelays();

    for (const conn of relays) {
      conn.publish(event);
    }
    return relays.length;
  }

  subscribe(opts: SubscribeOptions): string {
    const subId = nextSubId();
    const { filters, relayUrls, onEvent, onEOSE } = opts;

    this.onEventCallbacks.set(subId, onEvent);
    if (onEOSE) {
      this.onEOSECallbacks.set(subId, onEOSE);
    }

    // Indexer-only relays serve just kind:0/3/10002 and cap concurrent REQs hard.
    // Drop them from any subscription carrying other kinds — otherwise engagement
    // (kind 7/6/1), chat, and note subs flood them with "too many concurrent REQs"
    // and they reject the profile queries too. This guard applies even when a caller
    // explicitly targets PROFILE_RELAYS (e.g. NoteCard's reaction sub).
    const indexerSafe = isIndexerSafe(filters);

    if (relayUrls) {
      const urls = indexerSafe ? relayUrls : relayUrls.filter((u) => !INDEXER_SET.has(u));
      // Track intended URLs so deferred relays get the subscription when they connect
      this.pendingSubscriptions.set(subId, { filters, intendedUrls: urls });

      let sentNow = 0;
      const notConnected: string[] = [];
      for (const url of urls) {
        let conn = this.connections.get(url);
        if (!conn) {
          // The relay was targeted but never dialed. This is the bug behind
          // profiles stuck as hashes: PROFILE_RELAYS includes indexer-only relays
          // (purplepag.es / user.kindpag.es) that nothing else connects, so kind:0
          // REQs had nowhere to go. Dial it read-only now; forwardPendingSubscriptions
          // (re)sends the REQ once the socket opens.
          conn = this.connect(url, "read");
        }
        if (conn.getStatus() === "connected") {
          conn.subscribe(subId, filters);
          sentNow++;
        } else {
          conn.subscribe(subId, filters); // queues internally until WS opens
          notConnected.push(`${shortRelay(url)}:${conn.getStatus()}`);
        }
      }
      const kinds = [...new Set(filters.flatMap((f) => f.kinds ?? []))].join(",");
      log.debug(
        `${subId} kinds=[${kinds}] → sent to ${sentNow}/${urls.length} connected${notConnected.length ? `; waiting on: ${notConnected.join(", ")}` : ""}`,
      );
    } else {
      // No specific URLs: send to all current read relays (minus indexers unless safe)
      const reads = this.getReadRelays().filter((c) => indexerSafe || !INDEXER_SET.has(c.url));
      for (const conn of reads) {
        conn.subscribe(subId, filters);
      }
      const kinds = [...new Set(filters.flatMap((f) => f.kinds ?? []))].join(",");
      log.debug(`${subId} kinds=[${kinds}] → broadcast to ${reads.length} read relays`);
    }

    return subId;
  }

  closeSubscription(subId: string): void {
    this.onEventCallbacks.delete(subId);
    this.onEOSECallbacks.delete(subId);
    this.pendingSubscriptions.delete(subId);
    for (const conn of this.connections.values()) {
      if (conn.hasSubscription(subId)) {
        conn.closeSubscription(subId);
      }
    }
  }

  getWriteRelays(): RelayConnection[] {
    return [...this.connections.values()].filter(
      (c) =>
        (c.mode === "write" || c.mode === "read+write") &&
        c.getStatus() === "connected",
    );
  }

  getReadRelays(): RelayConnection[] {
    return [...this.connections.values()].filter(
      (c) =>
        (c.mode === "read" || c.mode === "read+write") &&
        c.getStatus() === "connected",
    );
  }

  getAllConnections(): Map<string, RelayConnection> {
    return this.connections;
  }

  connectToBootstrap(): void {
    for (const url of BOOTSTRAP_RELAYS) {
      this.connect(url, "read+write");
    }
  }

  /** Re-attempt NIP-42 AUTH on every connection that has a pending challenge.
   *  Called after the user's signer/pubkey becomes available, to recover from
   *  the race where a relay sent its AUTH challenge before login completed. */
  replayAuth(): void {
    for (const conn of this.connections.values()) {
      conn.tryAuth();
    }
  }

  /** Wait for a specific relay to reach 'connected' status */
  waitForConnection(url: string, timeout = 10_000): Promise<boolean> {
    const conn = this.connections.get(url);
    if (!conn) return Promise.resolve(false);
    if (conn.getStatus() === "connected") return Promise.resolve(true);

    return new Promise((resolve) => {
      const done = (val: boolean) => {
        clearTimeout(timer);
        this.statusWaiters.delete(waiter);
        resolve(val);
      };
      const timer = setTimeout(() => done(false), timeout);
      const waiter: RelayStatusCallback = (relayUrl, status) => {
        if (relayUrl === url && status === "connected") done(true);
      };
      this.statusWaiters.add(waiter);
    });
  }

  /** Connect to bootstrap relays and wait until at least one is connected */
  async connectToBootstrapAndWait(timeout = 10_000): Promise<void> {
    this.connectToBootstrap();

    // Check if any are already connected
    for (const url of BOOTSTRAP_RELAYS) {
      const conn = this.connections.get(url);
      if (conn?.getStatus() === "connected") return;
    }

    // Wait for any one to connect
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.statusWaiters.delete(waiter);
        resolve();
      };
      // Resolve even on timeout -- subscriptions will queue in messageQueue
      const timer = setTimeout(done, timeout);
      const waiter: RelayStatusCallback = (relayUrl, status) => {
        if (status === "connected" && BOOTSTRAP_RELAYS.includes(relayUrl)) done();
      };
      this.statusWaiters.add(waiter);
    });
  }

  connectFromConfig(configs: RelayConfig[]): void {
    for (const cfg of configs) {
      this.connect(cfg.url, cfg.mode);
    }
  }

  /**
   * Publish an event and wait for OK responses from relays.
   * Resolves with relay responses when all relays respond or timeout.
   */
  publishWithConfirmation(
    event: NostrEvent,
    targets?: string[],
    timeout = 10_000,
  ): Promise<{ relayUrl: string; success: boolean; message: string }[]> {
    const relays = targets
      ? targets
          .map((url) => this.connections.get(url))
          .filter((c): c is RelayConnection => !!c)
      : this.getWriteRelays();

    if (relays.length === 0) {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      const results: { relayUrl: string; success: boolean; message: string }[] = [];
      const pending = new Set(relays.map((c) => c.url));
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.publishOKCallbacks.delete(event.id);
        resolve(results);
      };

      this.publishOKCallbacks.set(event.id, (relayUrl, success, message) => {
        if (!pending.has(relayUrl)) return;
        results.push({ relayUrl, success, message });
        pending.delete(relayUrl);
        if (pending.size === 0) finish();
      });

      for (const conn of relays) {
        conn.publish(event);
      }

      const timer = setTimeout(finish, timeout);
    });
  }

  /** Fetch NIP-11 relay info document to learn subscription limits.
   *  Non-blocking — if it fails, the default cap is used. */
  private async fetchNip11(url: string, conn: RelayConnection): Promise<void> {
    try {
      const httpUrl = url.replace("wss://", "https://").replace("ws://", "http://");
      const response = await fetch(httpUrl, {
        headers: { Accept: "application/nostr+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;
      const info = await response.json();
      const maxSubs = info?.limitation?.max_subscriptions;
      if (typeof maxSubs === "number" && maxSubs > 0) {
        conn.setMaxSubscriptions(maxSubs);
      }
    } catch {
      // NIP-11 not available — use default cap
    }
  }

  /** Forward pending subscriptions to a newly-connected relay */
  private forwardPendingSubscriptions(relayUrl: string, conn: RelayConnection): void {
    let forwarded = 0;
    for (const [subId, pending] of this.pendingSubscriptions) {
      if (!pending.intendedUrls.includes(relayUrl)) continue;
      if (conn.hasSubscription(subId)) continue;
      if (!this.onEventCallbacks.has(subId)) continue;
      conn.subscribe(subId, pending.filters);
      forwarded++;
    }
    if (forwarded > 0) {
      log.debug(`forwarded ${forwarded} pending subs to ${shortRelay(relayUrl)} on connect`);
    }
  }
}

/** Singleton relay manager */
export const relayManager = new RelayManagerImpl();
