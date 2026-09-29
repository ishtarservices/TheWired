// Send side of the kind-20016 media-key envelopes: one NIP-17 gift wrap per
// recipient (seal signed by us → the receiver's proof that the key belongs
// to our LiveKit identity), published to the recipient's inbox relays (kind
// 10050) with APP_RELAY as the fallback. No self-wrap: our own keys never
// need to reach our other devices. Wrap + seal expire after 120 s.
import type { DMMediaKeyEnvelope } from "@ishtarservices/shared-types";
import { KIND_DM_MEDIA_KEY, defaultExpirationFor, mediaKeyRumorTags } from "@ishtarservices/core";
import { buildRumor, createGiftWrappedDM } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, fallbackDMRelays } from "@/lib/nostr/dmRelayList";
import { store } from "@/store";

/** Publish `envelope` to `to`. Resolves once handed to the relay layer. */
export async function sendMediaKey(to: string, envelope: DMMediaKeyEnvelope): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const nowSec = Math.floor(Date.now() / 1000);
  const content = JSON.stringify(envelope);
  const rumor = await buildRumor(myPubkey, to, content, mediaKeyRumorTags(), {
    kind: KIND_DM_MEDIA_KEY,
  });
  const { wrap } = await createGiftWrappedDM(content, to, undefined, rumor, {
    expiration: defaultExpirationFor("media_key", nowSec),
  });
  const relays = (await getDMRelaysForPublish(to)) ?? [];
  relayManager.publish(wrap, relays.length > 0 ? relays : fallbackDMRelays());
}
