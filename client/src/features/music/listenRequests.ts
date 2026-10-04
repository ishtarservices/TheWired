import type { NostrEvent } from "@/types/nostr";
import { fetchIncomingProposals, resolveProposal } from "@/lib/api/proposals";
import { signAndPublish } from "@/lib/nostr/publish";
import { nip44Decrypt, nip44Encrypt } from "@/lib/nostr/nip44";
import { getEvent } from "@/lib/db/eventStore";
import { relayManager } from "@/lib/nostr/relayManager";
import { APP_RELAY } from "@/lib/nostr/constants";
import { verifyEventSync } from "@/lib/nostr/verifyEvent";
import { createListenRequestActions } from "./listenRequestActions";
import { readListenRequests, writeListenRequests } from "./listenRequestStorage";
import { spacePublishRelaysForAll } from "./spacePublish";
import type { ListenTarget } from "./listenRequestWire";

/**
 * One-shot relay query for the newest version of an address. Verifies every
 * event before trusting it: the result is the base the owner re-signs, so an
 * unverified copy from a hostile relay must never get through.
 */
function fetchLatestAddressable(target: ListenTarget, timeoutMs = 4000): Promise<NostrEvent | null> {
  return new Promise((resolve) => {
    const urls = [...new Set([APP_RELAY, ...relayManager.getWriteRelays().map((c) => c.url)])];
    let best: NostrEvent | null = null;
    let eose = 0;
    let done = false;
    let subId: string | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (subId) relayManager.closeSubscription(subId);
      resolve(best);
    };
    const timer = setTimeout(finish, timeoutMs);
    subId = relayManager.subscribe({
      filters: [{ kinds: [target.kind], authors: [target.ownerPubkey], "#d": [target.d], limit: 5 }],
      relayUrls: urls,
      onEvent: (event) => {
        if (event.kind !== target.kind || event.pubkey !== target.ownerPubkey) return;
        if (event.tags.find((t) => t[0] === "d")?.[1] !== target.d) return;
        if (best && event.created_at <= best.created_at) return;
        try {
          if (!verifyEventSync(event)) return;
        } catch {
          return;
        }
        best = event;
      },
      onEOSE: () => {
        eose += 1;
        if (eose >= urls.length) finish();
      },
    });
  });
}

export const listenRequestActions = createListenRequestActions({
  fetchIncoming: fetchIncomingProposals,
  resolve: resolveProposal,
  publish: signAndPublish,
  relaysFor: spacePublishRelaysForAll,
  loadStoredEvent: getEvent,
  fetchLatest: (target) => fetchLatestAddressable(target),
  crypto: (me) => ({
    decryptSelf: (ciphertext) => nip44Decrypt(me, ciphertext),
    encryptFor: (recipient, plaintext) => nip44Encrypt(recipient, plaintext),
  }),
  readRecords: readListenRequests,
  writeRecords: writeListenRequests,
  now: () => Math.floor(Date.now() / 1000),
});

export const {
  loadIncomingListenRequests,
  grantListenRequest,
  declineListenRequest,
  hydrateListenAccessRequests,
  requestListenAccess,
  forgetListenAccessRequest,
} = listenRequestActions;
