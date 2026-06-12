import { nanoid } from "nanoid";
import type { NostrFilter } from "../../types/nostr";
import { relayManager, isIndexerSafe, INDEXER_URL_SET } from "./relayManager";
import { processIncomingEvent } from "./eventPipeline";
import { SUBSCRIPTION } from "./constants";
import { createLogger } from "../debug/logger";

const log = createLogger("sub");

/** Why onEOSE fired. `all-eose` = every tracked relay returned EOSE (an honest
 *  end-of-stored-events). `timeout` = the backstop fired first (a relay never
 *  EOSE'd). `no-relays` = nothing to wait on. Callers that conclude "no more to
 *  page" MUST only do so on `all-eose` — a `timeout` says nothing about whether
 *  more events exist (#78). */
export type EoseReason = "all-eose" | "timeout" | "no-relays";

/** Backstop for the all-EOSE wait: if some relay never EOSEs (was stripped by
 *  the indexer guard, disconnected mid-flight, etc.), fire onEOSE anyway so the
 *  UI's "loading" state can clear. Mirrors profileCache.flushBatch's BATCH_TIMEOUT_MS. */
const EOSE_TIMEOUT_MS = 5_000;
/** When a sub closes, log its lifetime event count if it exceeded this — flags
 *  the high-volume subs (engagement broadcasts, big feeds) that drive event-storm
 *  main-thread saturation, even if individual lines stayed quiet. */
const HIGH_VOLUME_THRESHOLD = 100;

interface ManagedSubscription {
  id: string;
  filters: NostrFilter[];
  relayUrls: string[];
  eoseReceived: Map<string, boolean>;
  onEOSE?: (info: { reason: EoseReason }) => void;
  isActive: boolean;
  createdAt: number;
  /** Most recent event created_at we've seen on this sub */
  latestEventAt: number;
  /** Backstop timer to fire onEOSE if the all-relays-EOSE quorum never resolves. */
  eoseTimer: ReturnType<typeof setTimeout> | null;
  /** Whether onEOSE has already been invoked (idempotent). */
  eoseFired: boolean;
  /** Total events delivered to this sub since open — used to flag high-volume
   *  subs in close logs and surfaced via wiredDebug.session(). */
  eventCount: number;
}

class SubscriptionManagerImpl {
  private subscriptions = new Map<string, ManagedSubscription>();

  subscribe(opts: {
    filters: NostrFilter[];
    relayUrls?: string[];
    onEOSE?: (info: { reason: EoseReason }) => void;
    /** EOSE backstop timeout (ms). Defaults to EOSE_TIMEOUT_MS; pagination passes
     *  a longer value so a slow relay doesn't falsely report "done". */
    timeoutMs?: number;
  }): string {
    const id = nanoid(SUBSCRIPTION.MAX_SUB_ID_LENGTH);
    const requestedUrls =
      opts.relayUrls ??
      relayManager.getReadRelays().map((c) => c.url);

    // Mirror relayManager's indexer strip: if the filters aren't all in indexer
    // kinds {0,3,10002}, the indexer relays will never be subscribed AND therefore
    // never EOSE — tracking them in eoseReceived would wedge `allEose` permanently.
    const indexerSafe = isIndexerSafe(opts.filters);
    const trackedUrls = indexerSafe
      ? requestedUrls
      : requestedUrls.filter((u) => !INDEXER_URL_SET.has(u));

    const eoseReceived = new Map<string, boolean>();
    for (const url of trackedUrls) {
      eoseReceived.set(url, false);
    }

    const fireEose = (reason: EoseReason) => {
      if (!sub.isActive || sub.eoseFired) return;
      sub.eoseFired = true;
      if (sub.eoseTimer !== null) {
        clearTimeout(sub.eoseTimer);
        sub.eoseTimer = null;
      }
      sub.onEOSE?.({ reason });
    };

    const sub: ManagedSubscription = {
      id,
      filters: opts.filters,
      relayUrls: trackedUrls,
      eoseReceived,
      onEOSE: opts.onEOSE,
      isActive: true,
      createdAt: Date.now(),
      latestEventAt: 0,
      eoseTimer: null,
      eoseFired: false,
      eventCount: 0,
    };

    // Backstop: if a tracked relay disconnects mid-sub or otherwise never EOSEs,
    // surface "done loading" anyway so the UI doesn't hang. Fast relays' EOSE
    // still wins by firing fireEose() early.
    if (opts.onEOSE && trackedUrls.length > 0) {
      sub.eoseTimer = setTimeout(
        () => fireEose("timeout"),
        opts.timeoutMs ?? EOSE_TIMEOUT_MS,
      );
    } else if (opts.onEOSE && trackedUrls.length === 0) {
      // Nothing to wait on (every relay was stripped) → fire immediately.
      queueMicrotask(() => fireEose("no-relays"));
    }

    this.subscriptions.set(id, sub);

    // Open via relayManager — pass the ORIGINAL requested URLs (relayManager
    // does its own strip). The tracking map only governs the EOSE quorum.
    relayManager.subscribe({
      filters: opts.filters,
      relayUrls: requestedUrls,
      onEvent: (event, relayUrl) => {
        if (!sub.isActive) return;
        sub.eventCount++;
        // Track latest event time for reconnect `since`
        if (event.created_at > sub.latestEventAt) {
          sub.latestEventAt = event.created_at;
        }
        processIncomingEvent(event, relayUrl);
      },
      onEOSE: (_subId, relayUrl) => {
        if (!sub.isActive) return;
        // Untracked (indexer) relays don't count — guard so a forwarded sub
        // doesn't accidentally flip the quorum.
        if (!sub.eoseReceived.has(relayUrl)) return;
        sub.eoseReceived.set(relayUrl, true);

        const allEose = [...sub.eoseReceived.values()].every(Boolean);
        if (allEose) fireEose("all-eose");
      },
    });

    return id;
  }

  /** One-shot subscription: resolves with the EOSE reason and auto-closes on
   *  EVERY path (all-eose / timeout / no-relays), so callers can't leak the sub
   *  by forgetting to close it. Replaces the hand-rolled settled/timeout/close
   *  boilerplate in the pagination helpers. Events still flow through the normal
   *  pipeline; the resolved value is for control flow (e.g. #78 hasMore). */
  subscribeOnce(opts: {
    filters: NostrFilter[];
    relayUrls?: string[];
    timeoutMs?: number;
  }): Promise<{ reason: EoseReason }> {
    return new Promise((resolve) => {
      const subId = this.subscribe({
        filters: opts.filters,
        relayUrls: opts.relayUrls,
        timeoutMs: opts.timeoutMs,
        onEOSE: (info) => {
          this.close(subId);
          resolve(info);
        },
      });
    });
  }

  close(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.isActive = false;
      if (sub.eoseTimer !== null) {
        clearTimeout(sub.eoseTimer);
        sub.eoseTimer = null;
      }
      if (sub.eventCount >= HIGH_VOLUME_THRESHOLD) {
        const lifetimeSec = ((Date.now() - sub.createdAt) / 1000).toFixed(1);
        const kinds = [...new Set(sub.filters.flatMap((f) => f.kinds ?? []))].join(",");
        log.info(
          `high-volume sub ${subId} closed — ${sub.eventCount} events over ${lifetimeSec}s  kinds=[${kinds}]`,
        );
      }
      relayManager.closeSubscription(subId);
      this.subscriptions.delete(subId);
    }
  }

  closeAll(): void {
    for (const [id] of this.subscriptions) {
      this.close(id);
    }
  }

  /** Get reconnect `since` for a subscription (latest event - 60s buffer) */
  getReconnectSince(subId: string): number | undefined {
    const sub = this.subscriptions.get(subId);
    if (sub && sub.latestEventAt > 0) {
      return sub.latestEventAt - 60;
    }
    return undefined;
  }

  isActive(subId: string): boolean {
    return this.subscriptions.get(subId)?.isActive ?? false;
  }

  getSubscription(subId: string): ManagedSubscription | undefined {
    return this.subscriptions.get(subId);
  }

  getAllSubscriptions(): Map<string, ManagedSubscription> {
    return this.subscriptions;
  }

  getActiveCount(): number {
    return this.subscriptions.size;
  }
}

export const subscriptionManager = new SubscriptionManagerImpl();
