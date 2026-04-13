import type { NostrEvent, NostrFilter } from "../../types/nostr";
import type { RelayMode } from "../../types/relay";
import type { RelayEventCallback, RelayEOSECallback, RelayOKCallback, RelayStatusCallback, SubscribeOptions, RelayConfig } from "./types";
import { RelayConnection } from "./relayConnection";
import { StormDetector } from "./reconnect";
import { BOOTSTRAP_RELAYS } from "./constants";

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

  /** Tracks active subscriptions that targeted specific relay URLs.
   *  When a relay connects for the first time, pending subs are forwarded to it. */
  private pendingSubscriptions = new Map<string, {
    filters: NostrFilter[];
    intendedUrls: string[];
  }>();

  /** Per-event-id callbacks for publish confirmation (used by publishWithConfirmation) */
  private publishOKCallbacks = new Map<string, (relayUrl: string, success: boolean, message: string) => void>();

  setGlobalCallbacks(cbs: {
    onOK?: RelayOKCallback;
    onStatusChange?: RelayStatusCallback;
  }) {
    if (cbs.onOK) this.globalOnOK = cbs.onOK;
    if (cbs.onStatusChange) this.globalOnStatusChange = cbs.onStatusChange;
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
        if (status === "connected") {
          this.forwardPendingSubscriptions(relayUrl, conn);
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

    if (relayUrls) {
      // Track intended URLs so deferred relays get the subscription when they connect
      this.pendingSubscriptions.set(subId, { filters, intendedUrls: relayUrls });

      for (const url of relayUrls) {
        const conn = this.connections.get(url);
        if (conn) {
          conn.subscribe(subId, filters);
        }
      }
    } else {
      // No specific URLs: send to all current read relays
      for (const conn of this.getReadRelays()) {
        conn.subscribe(subId, filters);
      }
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

  /** Wait for a specific relay to reach 'connected' status */
  waitForConnection(url: string, timeout = 10_000): Promise<boolean> {
    const conn = this.connections.get(url);
    if (!conn) return Promise.resolve(false);
    if (conn.getStatus() === "connected") return Promise.resolve(true);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeout);

      const prevOnStatusChange = this.globalOnStatusChange;
      const check: RelayStatusCallback = (relayUrl, status) => {
        prevOnStatusChange?.(relayUrl, status);
        if (relayUrl === url && status === "connected") {
          clearTimeout(timer);
          this.globalOnStatusChange = prevOnStatusChange;
          resolve(true);
        }
      };
      this.globalOnStatusChange = check;
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
      const timer = setTimeout(() => {
        // Resolve even on timeout -- subscriptions will queue in messageQueue
        resolve();
      }, timeout);

      const prevOnStatusChange = this.globalOnStatusChange;
      const check: RelayStatusCallback = (relayUrl, status, error) => {
        prevOnStatusChange?.(relayUrl, status, error);
        if (status === "connected" && BOOTSTRAP_RELAYS.includes(relayUrl)) {
          clearTimeout(timer);
          this.globalOnStatusChange = prevOnStatusChange;
          resolve();
        }
      };
      this.globalOnStatusChange = check;
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
    // forwarded count unused but kept for future diagnostics if needed
    void forwarded;
  }
}

/** Singleton relay manager */
export const relayManager = new RelayManagerImpl();
