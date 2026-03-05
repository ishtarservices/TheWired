import type { NostrEvent } from "../../types/nostr";
import { normalizeRelayUrl } from "./nip65";
import { relayManager } from "./relayManager";
import { BOOTSTRAP_RELAYS } from "./constants";
import { store } from "../../store";

/** Parse a kind:10050 DM relay list event into relay URLs */
export function parseDMRelayList(event: NostrEvent): string[] {
  if (event.kind !== 10050) return [];

  const urls: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "relay" || !tag[1]) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (url) urls.push(url);
  }
  return urls;
}

/** In-memory cache of fetched DM relay lists */
const dmRelayCache = new Map<string, string[]>();

/** In-flight fetch promises to deduplicate concurrent requests */
const pendingFetches = new Map<string, Promise<string[]>>();

/**
 * Fetch a pubkey's kind:10050 DM relay list from bootstrap relays.
 * Results are cached in memory. Concurrent fetches for the same pubkey are deduped.
 */
export function fetchDMRelayList(pubkey: string): Promise<string[]> {
  const cached = dmRelayCache.get(pubkey);
  if (cached) return Promise.resolve(cached);

  const pending = pendingFetches.get(pubkey);
  if (pending) return pending;

  const promise = new Promise<string[]>((resolve) => {
    let resolved = false;
    let bestEvent: NostrEvent | null = null;

    const subId = relayManager.subscribe({
      filters: [{ kinds: [10050], authors: [pubkey], limit: 1 }],
      relayUrls: BOOTSTRAP_RELAYS,
      onEvent: (event) => {
        if (!bestEvent || event.created_at > bestEvent.created_at) {
          bestEvent = event;
        }
      },
      onEOSE: () => {
        if (resolved) return;
        resolved = true;
        relayManager.closeSubscription(subId);
        const relays = bestEvent ? parseDMRelayList(bestEvent) : [];
        dmRelayCache.set(pubkey, relays);
        pendingFetches.delete(pubkey);
        resolve(relays);
      },
    });

    // Timeout fallback in case EOSE never arrives
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      relayManager.closeSubscription(subId);
      const relays = bestEvent ? parseDMRelayList(bestEvent) : [];
      dmRelayCache.set(pubkey, relays);
      pendingFetches.delete(pubkey);
      resolve(relays);
    }, 8000);
  });

  pendingFetches.set(pubkey, promise);
  return promise;
}

/**
 * Get the relay URLs to publish a gift wrap to a recipient.
 * Fetches their kind:10050, connects to those relays, and waits briefly for connections.
 * Returns the relay URLs if found, or undefined to fall back to all write relays.
 */
export async function getDMRelaysForPublish(
  recipientPubkey: string,
): Promise<string[] | undefined> {
  const relays = await fetchDMRelayList(recipientPubkey);
  if (relays.length === 0) return undefined;

  // Connect to any relays we're not already connected to
  for (const url of relays) {
    relayManager.connect(url);
  }

  // Wait briefly for connections to establish
  await Promise.all(
    relays.map((url) => relayManager.waitForConnection(url, 3000)),
  );

  return relays;
}

/** Get the current user's own DM relay list from Redux state */
export function getOwnDMRelays(): string[] {
  return store.getState().identity.dmRelayList;
}

/** Clear the in-memory DM relay cache (call on logout) */
export function clearDMRelayCache(): void {
  dmRelayCache.clear();
  pendingFetches.clear();
}
