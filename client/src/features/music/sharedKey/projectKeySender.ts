// Send side of the shared-project key DM (kind 20017, soot
// docs/collab-shared-key.md §2): one NIP-17 gift wrap to the new holder plus a
// self-wrap for my other devices. No expiration (a new device of the recipient
// must still find it). Every copy also goes to the app relay: a fresh login
// gets full gift-wrap history only from its NIP-77 reconcile.

import { buildRumor, createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays, fallbackDMRelays } from "@/lib/nostr/dmRelayList";
import { APP_RELAY } from "@/lib/nostr/constants";
import { store } from "@/store";
import { KIND_DM_PROJECT_KEY, buildProjectKeyDMContent } from "./projectKeyDM";
import { loadProjectSecret } from "./projectKeyStore";

function withAppRelay(relays: string[]): string[] {
  return [...new Set([...relays, APP_RELAY])];
}

/** Share the project key behind `coord` with `to`. Resolves once both wraps
 *  are handed to the relay layer; throws if the recipient copy reached none. */
export async function sendProjectKey(to: string, coord: string, secretKey: Uint8Array): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const content = buildProjectKeyDMContent(coord, secretKey);
  const rumor = await buildRumor(myPubkey, to, content, undefined, { kind: KIND_DM_PROJECT_KEY });

  const { wrap } = await createGiftWrappedDM(content, to, undefined, rumor);
  const theirs = withAppRelay((await getDMRelaysForPublish(to)) ?? fallbackDMRelays());
  relayManager.connect(APP_RELAY, "read+write");
  const sent = relayManager.publish(wrap, theirs);

  const { wrap: selfWrap } = await createSelfWrap(content, to, undefined, rumor);
  const own = getOwnDMRelays();
  relayManager.publish(selfWrap, withAppRelay(own.length > 0 ? own : fallbackDMRelays()));

  if (sent === 0) throw new Error("The key couldn't be sent: no relay accepted it.");
}

/** Send a key this device holds to `to` (kind 20017 key DM + self-wrap). */
export async function shareHeldProjectKey(projectPubkey: string, to: string): Promise<void> {
  const account = store.getState().identity.pubkey;
  const coord = store.getState().music.heldProjectKeys[projectPubkey];
  if (!account || !coord) throw new Error("This project's key isn't on this device.");
  const secretKey = await loadProjectSecret(account, projectPubkey);
  if (!secretKey) throw new Error("This project's key isn't on this device.");
  await sendProjectKey(to, coord, secretKey);
}
