import type { NostrEvent, NostrFilter, RelayMessage, ClientMessage } from "../../types/nostr";
import type { RelayMode, RelayStatus } from "../../types/relay";
import type { RelayEOSECallback, RelayOKCallback, RelayStatusCallback } from "./types";
import { computeBackoff, StormDetector } from "./reconnect";

/** Internal callback that includes the subscription ID for routing */
type InternalEventCallback = (subId: string, event: NostrEvent, relayUrl: string) => void;

/** Default subscription cap per relay if NIP-11 doesn't specify one.
 *  Conservative to stay under most public relays. */
const DEFAULT_MAX_SUBS = 20;

export class RelayConnection {
  readonly url: string;
  readonly mode: RelayMode;

  private ws: WebSocket | null = null;
  private status: RelayStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<string, NostrFilter[]>();
  private pendingEOSE = new Set<string>();
  private messageQueue: ClientMessage[] = [];
  private latencyMs = 0;
  private pingStart = 0;
  private eventCount = 0;

  /** Per-relay subscription cap (from NIP-11 or default). */
  private maxSubscriptions = DEFAULT_MAX_SUBS;
  /** Overflow queue: subs that couldn't be sent because we're at the cap. */
  private deferredSubs: Array<{ subId: string; filters: NostrFilter[] }> = [];

  // Callbacks
  private onEvent: InternalEventCallback | null = null;
  private onEOSE: RelayEOSECallback | null = null;
  private onOK: RelayOKCallback | null = null;
  private onStatusChange: RelayStatusCallback | null = null;
  /** NIP-42 AUTH callback: receives (challenge, relayUrl) and should return a signed kind:22242 event */
  private onAuth: ((challenge: string, relayUrl: string) => Promise<NostrEvent | null>) | null = null;
  private stormDetector: StormDetector;

  /** Short relay name for logging (computed once). */
  private shortUrl: string;

  constructor(url: string, mode: RelayMode, stormDetector: StormDetector) {
    this.url = url;
    this.mode = mode;
    this.stormDetector = stormDetector;
    this.shortUrl = url.replace("wss://", "").replace("ws://", "").replace(/\/$/, "");
  }

  setCallbacks(cbs: {
    onEvent?: InternalEventCallback;
    onEOSE?: RelayEOSECallback;
    onOK?: RelayOKCallback;
    onStatusChange?: RelayStatusCallback;
    onAuth?: (challenge: string, relayUrl: string) => Promise<NostrEvent | null>;
  }) {
    if (cbs.onEvent) this.onEvent = cbs.onEvent;
    if (cbs.onEOSE) this.onEOSE = cbs.onEOSE;
    if (cbs.onOK) this.onOK = cbs.onOK;
    if (cbs.onStatusChange) this.onStatusChange = cbs.onStatusChange;
    if (cbs.onAuth) this.onAuth = cbs.onAuth;
  }

  connect(): void {
    if (this.ws && (this.status === "connecting" || this.status === "connected")) {
      return;
    }
    this.setStatus("connecting");
    this.pingStart = Date.now();

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.setStatus("error", "Failed to create WebSocket");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.latencyMs = Date.now() - this.pingStart;
      this.reconnectAttempts = 0;
      this.setStatus("connected");
      this.flushQueue();
      this.resubscribe();
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as RelayMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      this.setStatus("error", "WebSocket error");
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.status !== "disconnected") {
        this.stormDetector.recordDisconnect();
        this.setStatus("disconnected");
        this.scheduleReconnect();
      }
    };
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.setStatus("disconnected");
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.subscriptions.clear();
    this.pendingEOSE.clear();
    this.messageQueue = [];
    this.deferredSubs = [];
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  /** Update the subscription cap (called after fetching NIP-11). */
  setMaxSubscriptions(max: number): void {
    this.maxSubscriptions = max;
  }

  subscribe(subId: string, filters: NostrFilter[]): void {
    this.subscriptions.set(subId, filters);
    this.pendingEOSE.add(subId);

    // Enforce per-relay subscription cap — defer if at limit
    const activeSent = this.subscriptions.size - this.deferredSubs.length;
    if (activeSent >= this.maxSubscriptions) {
      this.deferredSubs.push({ subId, filters });
      return;
    }

    // Send REQ directly if connected; otherwise resubscribe() handles it on connect.
    // Do NOT queue REQs — that causes double-sends when flushQueue + resubscribe both fire.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(["REQ", subId, ...filters]));
    }
  }

  closeSubscription(subId: string): void {
    this.subscriptions.delete(subId);
    this.pendingEOSE.delete(subId);
    // Remove from deferred queue if it was never sent
    this.deferredSubs = this.deferredSubs.filter((d) => d.subId !== subId);
    this.send(["CLOSE", subId]);
    // A slot opened — drain the next deferred sub
    this.drainDeferred();
  }

  /** Send the next deferred subscription if a slot is available. */
  private drainDeferred(): void {
    if (this.deferredSubs.length === 0) return;
    const activeSent = this.subscriptions.size - this.deferredSubs.length;
    if (activeSent >= this.maxSubscriptions) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const next = this.deferredSubs.shift()!;
    // The sub may have been closed while deferred
    if (!this.subscriptions.has(next.subId)) {
      this.drainDeferred(); // try next
      return;
    }

    this.ws.send(JSON.stringify(["REQ", next.subId, ...next.filters]));
  }

  publish(event: NostrEvent): void {
    this.send(["EVENT", event]);
  }

  getStatus(): RelayStatus {
    return this.status;
  }

  getLatency(): number {
    return this.latencyMs;
  }

  getEventCount(): number {
    return this.eventCount;
  }

  hasSubscription(subId: string): boolean {
    return this.subscriptions.has(subId);
  }

  private handleMessage(msg: RelayMessage): void {
    switch (msg[0]) {
      case "EVENT": {
        this.eventCount++;
        this.onEvent?.(msg[1], msg[2], this.url);
        break;
      }
      case "EOSE": {
        this.pendingEOSE.delete(msg[1]);
        this.onEOSE?.(msg[1], this.url);
        break;
      }
      case "OK": {
        this.onOK?.(msg[1], msg[2], msg[3], this.url);
        break;
      }
      case "NOTICE": {
        console.warn(`[Relay ${this.shortUrl}] NOTICE: ${msg[1]}`);
        break;
      }
      case "CLOSED": {
        this.subscriptions.delete(msg[1]);
        this.pendingEOSE.delete(msg[1]);
        break;
      }
      case "AUTH": {
        // NIP-42 auth challenge — sign and respond with kind:22242
        const challenge = msg[1] as string;
        if (challenge && this.onAuth) {
          this.onAuth(challenge, this.url).then((signedEvent) => {
            if (signedEvent && this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify(["AUTH", signedEvent]));
            }
          }).catch(() => {});
        }
        break;
      }
    }
  }

  private setStatus(status: RelayStatus, error?: string): void {
    this.status = status;
    this.onStatusChange?.(this.url, status, error);
  }

  private flushQueue(): void {
    const queue = this.messageQueue;
    this.messageQueue = [];
    for (const msg of queue) {
      this.send(msg);
    }
  }

  /** Re-send all active subscriptions after reconnect, staggered in batches
   *  to avoid overwhelming relays with concurrent REQs. */
  private resubscribe(): void {
    const entries = [...this.subscriptions.entries()];
    if (entries.length === 0) return;

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 150;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      const delay = (i / BATCH_SIZE) * BATCH_DELAY_MS;

      if (delay === 0) {
        for (const [subId, filters] of batch) {
          this.pendingEOSE.add(subId);
          this.send(["REQ", subId, ...filters]);
        }
      } else {
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            for (const [subId, filters] of batch) {
              if (!this.subscriptions.has(subId)) continue;
              this.pendingEOSE.add(subId);
              this.send(["REQ", subId, ...filters]);
            }
          }
        }, delay);
      }
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const stormCooldown = this.stormDetector.getCooldown();
    const backoff = computeBackoff(this.reconnectAttempts);
    const delay = Math.max(backoff, stormCooldown);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
