import type { NostrEvent, NostrFilter, RelayMessage, ClientMessage } from "../../types/nostr";
import type { RelayMode, RelayStatus } from "../../types/relay";
import type { RelayEOSECallback, RelayOKCallback, RelayStatusCallback } from "./types";
import { computeBackoff, StormDetector } from "./reconnect";

/** Internal callback that includes the subscription ID for routing */
type InternalEventCallback = (subId: string, event: NostrEvent, relayUrl: string) => void;

/** Default subscription cap per relay if NIP-11 doesn't specify one.
 *  Sized for users in many spaces: bg chat sub per joined space + a handful of
 *  priority subs (relay list, DM, gift wrap, music, followers). 100 leaves
 *  comfortable headroom; per-relay NIP-11 can still narrow this. */
const DEFAULT_MAX_SUBS = 100;

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
  /** Warn once per connection lifetime when the cap is first hit. Silent
   *  deferral was the failure mode that hid the original NIP-29 chat bug —
   *  surface it so future regressions don't quietly queue forever. */
  private hasWarnedDeferral = false;

  // Callbacks
  private onEvent: InternalEventCallback | null = null;
  private onEOSE: RelayEOSECallback | null = null;
  private onOK: RelayOKCallback | null = null;
  private onStatusChange: RelayStatusCallback | null = null;
  /** NIP-42 AUTH callback: receives (challenge, relayUrl) and should return a signed kind:22242 event */
  private onAuth: ((challenge: string, relayUrl: string) => Promise<NostrEvent | null>) | null = null;
  /** Last AUTH challenge from this relay that hasn't been answered successfully yet.
   *  Cached so we can replay AUTH after the user's signer becomes available
   *  (when the relay connects before login completes). */
  private pendingAuthChallenge: string | null = null;
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
      // Old AUTH challenge is invalid for the next session; clear it so we
      // don't replay a stale challenge that the relay will reject.
      this.pendingAuthChallenge = null;
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
    this.pendingAuthChallenge = null;
  }

  /** Attempt to answer the cached AUTH challenge. Safe to call multiple times.
   *  Used both at challenge-receipt time and after login, to handle the case
   *  where the relay connected before the user's signer was ready. */
  tryAuth(): void {
    const challenge = this.pendingAuthChallenge;
    const wsOpen = this.ws?.readyState === WebSocket.OPEN;
    // No challenge cached, callback not wired, or WS not open: caller will
    // retry on the next replay. Silent — `replayAuth` already logs a summary.
    if (!challenge || !this.onAuth || !wsOpen) return;

    this.onAuth(challenge, this.url).then((signedEvent) => {
      if (!signedEvent) {
        // Common during cold-start: relay challenged before signer is ready.
        // Subsequent replayAuth call (post-login) will succeed.
        return;
      }
      if (this.ws?.readyState !== WebSocket.OPEN) {
        console.warn(`[auth] ${this.shortUrl} WS closed between sign and send, dropping AUTH`);
        return;
      }
      // Verify challenge hasn't been superseded between the await and now.
      if (this.pendingAuthChallenge !== challenge) {
        console.warn(`[auth] ${this.shortUrl} challenge superseded mid-sign, dropping`);
        return;
      }
      this.ws.send(JSON.stringify(["AUTH", signedEvent]));
      this.pendingAuthChallenge = null;
    }).catch((err) => {
      console.warn(`[auth] ${this.shortUrl} AUTH error`, err);
    });
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

    // Enforce per-relay subscription cap — defer if sending this one would exceed it.
    // `activeSent` is post-set, so it represents the sent count *if* we send this sub.
    const activeSent = this.subscriptions.size - this.deferredSubs.length;
    if (activeSent > this.maxSubscriptions) {
      this.deferredSubs.push({ subId, filters });
      this.warnIfFirstDeferral();
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

  /** Warn once per connection lifetime when the subscription cap is hit.
   *  The original NIP-29 chat bug presented as "messages don't show up" because
   *  the channel REQ silently sat in `deferredSubs` after the cap was reached.
   *  Surfacing this makes that class of failure self-diagnosing in console. */
  private warnIfFirstDeferral(): void {
    if (this.hasWarnedDeferral) return;
    this.hasWarnedDeferral = true;
    console.warn(
      `[relay] ${this.shortUrl} subscription cap (${this.maxSubscriptions}) reached — new subs deferred until a slot opens`,
    );
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
        // Surface unexpected server-side closes (cap exceeded, rate-limited, etc.).
        // An empty reason is the normal response to our own CLOSE — not noteworthy.
        const reason = (msg[2] ?? "").toString();
        if (reason) {
          console.warn(`[relay] ${this.shortUrl} CLOSED ${msg[1]}: ${reason}`);
        }
        this.subscriptions.delete(msg[1]);
        this.pendingEOSE.delete(msg[1]);
        break;
      }
      case "AUTH": {
        // NIP-42 auth challenge — sign and respond with kind:22242
        const challenge = msg[1] as string;
        if (!challenge) break;
        // Cache the challenge so we can replay AUTH if the signer isn't ready yet.
        this.pendingAuthChallenge = challenge;
        this.tryAuth();
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

  /** Re-send active subscriptions after reconnect, staggered in batches
   *  to avoid overwhelming relays with concurrent REQs. Respects the relay
   *  subscription cap so the server doesn't reject overflow with CLOSED
   *  (which would permanently delete those subs from this connection). */
  private resubscribe(): void {
    const entries = [...this.subscriptions.entries()];
    if (entries.length === 0) return;

    // Server state is fresh after reconnect — re-decide what's deferred from scratch.
    this.deferredSubs = [];

    const toSend: Array<[string, NostrFilter[]]> = [];
    for (const entry of entries) {
      if (toSend.length < this.maxSubscriptions) {
        toSend.push(entry);
      } else {
        this.deferredSubs.push({ subId: entry[0], filters: entry[1] });
      }
    }
    if (this.deferredSubs.length > 0) {
      this.warnIfFirstDeferral();
    }

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 150;

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      const batch = toSend.slice(i, i + BATCH_SIZE);
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
