// Send side of the kind-20016 media-key envelopes: one NIP-17 gift wrap per
// recipient (seal signed by us → the receiver's proof that the key belongs
// to our LiveKit identity), published to the recipient's inbox relays (kind
// 10050) with APP_RELAY as the fallback. No self-wrap: our own keys never
// need to reach our other devices. Wrap + seal expire 45 s after they are
// built (`ttl`, stamped after any wait for the signer): under the backend's
// 60 s signal line, so a key wrap is never pushed as a "new message" — a
// room used to ring every co-participant's phone on each join, leave and
// reconnect.
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";
import { KIND_DM_MEDIA_KEY, mediaKeyRumorTags, signalTtlFor } from "@ishtarservices/core";
import { buildRumor, createGiftWrappedDM } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, fallbackDMRelays } from "@/lib/nostr/dmRelayList";
import { store } from "@/store";

/**
 * Publish `envelope` to `to`. Resolves once handed to the relay layer.
 *
 * `from` is the account whose LiveKit identity the key belongs to (the
 * session's). The seal is signed by whichever signer is active, so if the
 * account changed under a still-running session, sending would seal THIS
 * room's key with ANOTHER account's key. That publicly links the two accounts,
 * and receivers drop it anyway (sender ≠ identity). Refuse instead.
 */
export async function sendMediaKey(
  to: string,
  envelope: DMMediaKeyEnvelope,
  from?: string,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  if (from && from !== myPubkey) {
    throw new Error("Account changed: not sealing a media key for another account's session");
  }
  const content = JSON.stringify(envelope);
  const rumor = await buildRumor(myPubkey, to, content, mediaKeyRumorTags(), {
    kind: KIND_DM_MEDIA_KEY,
  });
  const { wrap } = await createGiftWrappedDM(content, to, undefined, rumor, {
    ttl: signalTtlFor("media_key"),
  });
  const relays = (await getDMRelaysForPublish(to)) ?? [];
  relayManager.publish(wrap, relays.length > 0 ? relays : fallbackDMRelays());
}
