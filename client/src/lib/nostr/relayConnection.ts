import type { NostrEvent, NostrFilter, RelayMessage, ClientMessage } from "../../types/nostr";
import type { RelayMode, RelayStatus } from "../../types/relay";
import type { RelayEOSECallback, RelayOKCallback, RelayStatusCallback } from "./types";
import { computeBackoff, StormDetector } from "./reconnect";

/** Internal callback that includes the subscription ID for routing */
type InternalEventCallback = (subId: string, event: NostrEvent, relayUrl: string) => void;

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

  // Callbacks
  private onEvent: InternalEventCallback | null = null;
  private onEOSE: RelayEOSECallback | null = null;
  private onOK: RelayOKCallback | null = null;
  private onStatusChange: RelayStatusCallback | null = null;
  private stormDetector: StormDetector;

  constructor(url: string, mode: RelayMode, stormDetector: StormDetector) {
    this.url = url;
    this.mode = mode;
    this.stormDetector = stormDetector;
  }

  setCallbacks(cbs: {
    onEvent?: InternalEventCallback;
    onEOSE?: RelayEOSECallback;
    onOK?: RelayOKCallback;
    onStatusChange?: RelayStatusCallback;
  }) {
    if (cbs.onEvent) this.onEvent = cbs.onEvent;
    if (cbs.onEOSE) this.onEOSE = cbs.onEOSE;
    if (cbs.onOK) this.onOK = cbs.onOK;
    if (cbs.onStatusChange) this.onStatusChange = cbs.onStatusChange;
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
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  subscribe(subId: string, filters: NostrFilter[]): void {
    this.subscriptions.set(subId, filters);
    this.pendingEOSE.add(subId);
    this.send(["REQ", subId, ...filters]);
  }

  closeSubscription(subId: string): void {
    this.subscriptions.delete(subId);
    this.pendingEOSE.delete(subId);
    this.send(["CLOSE", subId]);
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
        console.warn(`[Relay ${this.url}] NOTICE: ${msg[1]}`);
        break;
      }
      case "CLOSED": {
        this.subscriptions.delete(msg[1]);
        this.pendingEOSE.delete(msg[1]);
        break;
      }
      case "AUTH": {
        // NIP-42 auth challenge - handled in later steps
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

  private resubscribe(): void {
    for (const [subId, filters] of this.subscriptions) {
      this.pendingEOSE.add(subId);
      this.send(["REQ", subId, ...filters]);
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
