import type { NostrEvent } from "../../types/nostr";
import { normalizeRelayUrl } from "./relayUrl";
import { isSafeRelayUrl } from "../security/ssrfGuard";
import { relayManager } from "./relayManager";
import { BOOTSTRAP_RELAYS, APP_RELAY } from "./constants";
import { store } from "../../store";

/** APP_RELAY in the normalized form parseDMRelayList emits, so a list that
 *  already names it dedupes against it. */
export const APP_RELAY_URL = normalizeRelayUrl(APP_RELAY) ?? APP_RELAY;

const relayKey = (u: string) => normalizeRelayUrl(u) ?? u;

/** Where a recipient wrap goes and which of those relays' OKs count as
 *  *sent* (docs/DM_WIRE_CONTRACT.md §1). The recipient's kind-10050 list
 *  (∪ platform relay) when they have one — every entry counts; otherwise
 *  every write relay plus the platform relay, and only the platform relay
 *  counts (it is the one relay the push ingester and the phone read). */
export async function recipientTargets(to: string): Promise<{ targets: string[]; countAs: string[] }> {
  const inbox = await getDMRelaysForPublish(to);
  if (inbox) return { targets: inbox, countAs: inbox };
  return { targets: fallbackDMRelays(), countAs: [APP_RELAY_URL] };
}

/** The self-wrap's relays: the own kind-10050 list (or the fallback set),
 *  always including the platform relay — our other devices sync from it.
 *  Deduped by normalized URL so a trailing-slash APP_RELAY never doubles a frame. */
export function selfWrapTargets(): string[] {
  const own = getOwnDMRelays();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...(own.length > 0 ? own : fallbackDMRelays()), APP_RELAY_URL]) {
    const k = relayKey(url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(url);
  }
  return out;
}

/** Parse a kind:10050 DM relay list event into relay URLs */
export function parseDMRelayList(event: NostrEvent): string[] {
  if (event.kind !== 10050) return [];

  const urls: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "relay" || !tag[1]) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (!url) continue;
    // SSRF guard: a kind:10050 published by the *recipient* (an attacker, when
    // you DM them) is fully attacker-controlled, and getDMRelaysForPublish dials
    // every entry via relayManager.connect. Drop loopback/private/link-local
    // hosts so it can't make the client connect to internal services. See
    // lib/security/ssrfGuard.ts. The one exemption is our own configured
    // platform relay (APP_RELAY): a dev build points it at loopback, and a
    // peer listing exactly that URL dials nothing we don't already dial.
    if (url === APP_RELAY_URL || isSafeRelayUrl(url)) urls.push(url);
  }
  return urls;
}

/** How long a fetched DM relay list is trusted before it is re-fetched, so a
 *  peer's updated kind:10050 is picked up without a relaunch. */
const DM_RELAY_CACHE_TTL_MS = 10 * 60 * 1000;

/** In-memory cache of fetched DM relay lists */
const dmRelayCache = new Map<string, { relays: string[]; at: number }>();

/** In-flight fetch promises to deduplicate concurrent requests */
const pendingFetches = new Map<string, Promise<string[]>>();

/**
 * Fetch a pubkey's kind:10050 DM relay list from bootstrap relays.
 * Results are cached in memory for DM_RELAY_CACHE_TTL_MS. Concurrent fetches
 * for the same pubkey are deduped.
 */
export function fetchDMRelayList(pubkey: string): Promise<string[]> {
  const cached = dmRelayCache.get(pubkey);
  if (cached && Date.now() - cached.at < DM_RELAY_CACHE_TTL_MS) return Promise.resolve(cached.relays);

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
        dmRelayCache.set(pubkey, { relays, at: Date.now() });
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
      dmRelayCache.set(pubkey, { relays, at: Date.now() });
      pendingFetches.delete(pubkey);
      resolve(relays);
    }, 8000);
  });

  pendingFetches.set(pubkey, promise);
  return promise;
}

/**
 * Get the relay URLs to publish a gift wrap to a recipient.
 * Fetches their kind:10050, connects to those relays (peer-only unless the user
 * chose them too — see relayManager.connectPeer), and waits briefly for connections.
 * Returns those relays plus APP_RELAY if found, or undefined to fall back to all write relays.
 */
export async function getDMRelaysForPublish(
  recipientPubkey: string,
): Promise<string[] | undefined> {
  const inbox = await fetchDMRelayList(recipientPubkey);
  if (inbox.length === 0) return undefined;

  // The platform relay always gets a copy, even when the recipient's list
  // omits it: our push pipeline only ingests wraps from it, and it is the relay
  // that AUTH-gates wraps to their recipient (docs/DM_WIRE_CONTRACT.md §7, §8).
  const relays = [...new Set([...inbox, APP_RELAY_URL])];

  // Dial what isn't connected yet (APP_RELAY is normally already up; dialing
  // it again is a no-op). A relay only the recipient's list names is dialed
  // peer-only: the socket never answers NIP-42 AUTH as the user and carries
  // nothing but the wrap, so the sender stays as anonymous there as the
  // ephemeral wrap key makes them (docs/DM_WIRE_CONTRACT.md §1). The platform
  // relay and the account's own DM relays are the user's choice and AUTH as
  // usual; connectPeer treats bootstrap and NIP-65 relays the same way.
  const own = new Set(getOwnDMRelays().map(relayKey));
  for (const url of relays) {
    if (url === APP_RELAY_URL || own.has(url)) relayManager.connect(url);
    else relayManager.connectPeer(url);
  }

  // Wait briefly for connections to establish
  await Promise.all(
    relays.map((url) => relayManager.waitForConnection(url, 3000)),
  );

  return relays;
}

/** Get the current user's own DM relay list from Redux state. Empty when the
 *  user never published a kind 10050 — callers then use `fallbackDMRelays()`. */
export function getOwnDMRelays(): string[] {
  return store.getState().identity.dmRelayList;
}

/**
 * Where a gift wrap goes when the target has no kind-10050 list: every
 * connected write relay PLUS the platform relay. The platform relay is the
 * one our push pipeline reads and the one AUTH-gates wraps to their recipient
 * (docs/DM_WIRE_CONTRACT.md §7); it must never be skipped just because it was
 * dialed read-only earlier in the session.
 */
export function fallbackDMRelays(): string[] {
  const writes = relayManager.getWriteRelays().map((c) => c.url);
  return [...new Set([...writes, APP_RELAY])];
}

/** Clear the in-memory DM relay cache (call on logout) */
export function clearDMRelayCache(): void {
  dmRelayCache.clear();
  pendingFetches.clear();
}
