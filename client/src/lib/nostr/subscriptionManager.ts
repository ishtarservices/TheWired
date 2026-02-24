import { nanoid } from "nanoid";
import type { NostrFilter } from "../../types/nostr";
import { relayManager } from "./relayManager";
import { processIncomingEvent } from "./eventPipeline";
import { SUBSCRIPTION } from "./constants";

interface ManagedSubscription {
  id: string;
  filters: NostrFilter[];
  relayUrls: string[];
  eoseReceived: Map<string, boolean>;
  onEOSE?: () => void;
  isActive: boolean;
  createdAt: number;
  /** Most recent event created_at we've seen on this sub */
  latestEventAt: number;
}

class SubscriptionManagerImpl {
  private subscriptions = new Map<string, ManagedSubscription>();

  subscribe(opts: {
    filters: NostrFilter[];
    relayUrls?: string[];
    onEOSE?: () => void;
  }): string {
    const id = nanoid(SUBSCRIPTION.MAX_SUB_ID_LENGTH);
    const relayUrls =
      opts.relayUrls ??
      relayManager.getReadRelays().map((c) => c.url);

    const eoseReceived = new Map<string, boolean>();
    for (const url of relayUrls) {
      eoseReceived.set(url, false);
    }

    const sub: ManagedSubscription = {
      id,
      filters: opts.filters,
      relayUrls,
      eoseReceived,
      onEOSE: opts.onEOSE,
      isActive: true,
      createdAt: Date.now(),
      latestEventAt: 0,
    };

    this.subscriptions.set(id, sub);

    // Open via relayManager
    relayManager.subscribe({
      filters: opts.filters,
      relayUrls,
      onEvent: (event, relayUrl) => {
        if (!sub.isActive) return;
        // Track latest event time for reconnect `since`
        if (event.created_at > sub.latestEventAt) {
          sub.latestEventAt = event.created_at;
        }
        processIncomingEvent(event, relayUrl);
      },
      onEOSE: (_subId, relayUrl) => {
        if (!sub.isActive) return;
        sub.eoseReceived.set(relayUrl, true);

        // Check if all relays sent EOSE
        const allEose = [...sub.eoseReceived.values()].every(Boolean);
        if (allEose) {
          sub.onEOSE?.();
        }
      },
    });

    return id;
  }

  close(subId: string): void {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.isActive = false;
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
}

export const subscriptionManager = new SubscriptionManagerImpl();
