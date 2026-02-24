import type { NostrEvent } from "../../types/nostr";
import type { RelayListEntry } from "../../types/relay";
import type { RelayMode } from "../../types/relay";
import { relayManager } from "./relayManager";
import { BOOTSTRAP_RELAYS } from "./constants";

/** Parse a kind:10002 relay list event into relay entries */
export function parseRelayList(event: NostrEvent): RelayListEntry[] {
  if (event.kind !== 10002) return [];

  const entries: RelayListEntry[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== "r" || !tag[1]) continue;

    const url = normalizeRelayUrl(tag[1]);
    if (!url) continue;

    let mode: RelayMode = "read+write";
    if (tag[2] === "read") mode = "read";
    else if (tag[2] === "write") mode = "write";

    entries.push({ url, mode });
  }

  return entries;
}

/** Fetch relay list for a pubkey from bootstrap relays */
export function fetchRelayList(
  pubkey: string,
  onResult: (entries: RelayListEntry[]) => void,
): string {
  return relayManager.subscribe({
    filters: [{ kinds: [10002], authors: [pubkey], limit: 1 }],
    relayUrls: BOOTSTRAP_RELAYS,
    onEvent: (event) => {
      const entries = parseRelayList(event);
      if (entries.length > 0) {
        onResult(entries);
      }
    },
    onEOSE: () => {
      // EOSE from bootstrap - relay list should be loaded by now
    },
  });
}

/** Normalize relay URL */
function normalizeRelayUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    // Ensure trailing slash is removed for consistency
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
