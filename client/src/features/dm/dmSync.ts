// NIP-77 inbox reconciliation (docs/DM_WIRE_CONTRACT.md §7.5).
//
// The gift-wrap inbox can't be paged by time: seal/wrap timestamps are
// randomized up to two days back. On relays that speak negentropy we
// reconcile `{kinds:[1059], "#p":[me]}` by event id instead, then REQ only the
// wraps we don't have. Relays that answer NOTICE/NEG-ERR are skipped; the
// since-window subscription in loginFlow remains the fallback for them.

import { store } from "@/store";
import { relayManager } from "@/lib/nostr/relayManager";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { EVENT_KINDS } from "@/types/nostr";

const CHUNK = 100;
export const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
export const RECONCILE_INITIAL_DELAY_MS = 8_000;

/** What we hold: wraps whose relay timestamp we know (rows since wire v1). */
function localWrapItems(): Array<{ id: string; created_at: number }> {
  const dm = store.getState().dm;
  const items: Array<{ id: string; created_at: number }> = [];
  for (const msgs of Object.values(dm.messages)) {
    for (const m of msgs) {
      if (m.wrapCreatedAt !== undefined) items.push({ id: m.wrapId, created_at: m.wrapCreatedAt });
    }
  }
  return items;
}

/** Reconcile the inbox against every given relay; returns how many wraps were requested. */
export async function reconcileGiftWrapInbox(myPubkey: string, relayUrls: string[]): Promise<number> {
  const filter = { kinds: [EVENT_KINDS.GIFT_WRAP], "#p": [myPubkey] };
  const items = localWrapItems();
  let requested = 0;
  for (const url of relayUrls) {
    let result: { need: string[]; have: string[] } | null;
    try {
      result = await relayManager.negentropySync(url, filter, items);
    } catch {
      result = null;
    }
    if (!result) continue;
    // Account switch mid-flight: never fetch for a stale identity.
    if (store.getState().identity.pubkey !== myPubkey) return requested;
    const processed = store.getState().dm.processedWrapIdSet;
    const need = result.need.filter((id) => !processed[id]);
    for (let i = 0; i < need.length; i += CHUNK) {
      const ids = need.slice(i, i + CHUNK);
      const subId = subscriptionManager.subscribe({
        filters: [{ ids }],
        relayUrls: [url],
        onEOSE: () => subscriptionManager.close(subId),
      });
      requested += ids.length;
    }
  }
  return requested;
}

/** Start periodic reconciliation; returns a stop function. */
export function startGiftWrapReconciliation(myPubkey: string, relayUrls: () => string[]): () => void {
  let stopped = false;
  const run = () => {
    if (stopped || store.getState().identity.pubkey !== myPubkey) return;
    void reconcileGiftWrapInbox(myPubkey, relayUrls()).catch(() => {});
  };
  const first = setTimeout(run, RECONCILE_INITIAL_DELAY_MS);
  const interval = setInterval(run, RECONCILE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
