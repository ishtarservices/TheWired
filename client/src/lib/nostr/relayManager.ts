import type { NostrEvent } from "../../types/nostr";
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
      },
      onStatusChange: (relayUrl, status, error) => {
        this.globalOnStatusChange?.(relayUrl, status, error);
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
  }

  publish(
    event: NostrEvent,
    targets?: string[],
  ): void {
    const relays = targets
      ? targets
          .map((url) => this.connections.get(url))
          .filter((c): c is RelayConnection => !!c)
      : this.getWriteRelays();

    for (const conn of relays) {
      conn.publish(event);
    }
  }

  subscribe(opts: SubscribeOptions): string {
    const subId = nextSubId();
    const { filters, relayUrls, onEvent, onEOSE } = opts;

    this.onEventCallbacks.set(subId, onEvent);
    if (onEOSE) {
      this.onEOSECallbacks.set(subId, onEOSE);
    }

    const targetRelays = relayUrls
      ? relayUrls
          .map((url) => this.connections.get(url))
          .filter((c): c is RelayConnection => !!c)
      : this.getReadRelays();

    for (const conn of targetRelays) {
      conn.subscribe(subId, filters);
    }

    return subId;
  }

  closeSubscription(subId: string): void {
    this.onEventCallbacks.delete(subId);
    this.onEOSECallbacks.delete(subId);
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
}

/** Singleton relay manager */
export const relayManager = new RelayManagerImpl();
