import { store } from "../../store";
import { updateSpace } from "../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../lib/db/spaceStore";
import { createLogger } from "../../lib/debug/logger";
import { isNip29Native, isEphemeralRelayHost, relayUrlToHost } from "./spaceType";
import { isPrivateOrLoopbackHost } from "./relaySet";
import type { EmbeddedRelayStatus } from "../../lib/relay/embeddedRelay";

const log = createLogger("spaces");

/**
 * Re-point spaces hosted on the user's OWN embedded relay to its CURRENT
 * loopback address.
 *
 * The embedded relay's address is unstable — both the OS-assigned loopback port
 * and the tunnel URL change on every restart — so a space pins a `hostRelay`
 * that goes dead after a restart, and the owner's own client connects to a
 * dead URL.
 *
 * We identify "this is my relay" two ways, because the precise anchor
 * (`relayPubkey`) can itself be stale on spaces created before the relay key
 * was stabilized:
 *   1. `relayPubkey` matches the running relay (exact), OR
 *   2. the space's CREATOR is the logged-in user AND its host is an
 *      ephemeral-tunnel / loopback address (heuristic) — i.e. a self-hosted
 *      space whose stored key drifted.
 * In both cases we set `hostRelay` to the live loopback URL and heal
 * `relayPubkey` to the current key, so future reconciles match exactly.
 *
 * Call this whenever the embedded relay's status is known to be running.
 */
export function reconcileSelfHostedSpaces(status: EmbeddedRelayStatus): void {
  if (!status.running || !status.ws_url || !status.pubkey) return;
  const liveUrl = status.ws_url;
  const pubkey = status.pubkey;
  const myPubkey = store.getState().identity.pubkey;

  for (const sp of store.getState().spaces.list) {
    if (!isNip29Native(sp)) continue;

    const host = relayUrlToHost(sp.hostRelay);
    const mineByKey = !!sp.relayPubkey && sp.relayPubkey === pubkey;
    const mineByCreator =
      !!myPubkey &&
      sp.creatorPubkey === myPubkey &&
      (isEphemeralRelayHost(host) || isPrivateOrLoopbackHost(host));

    if (!mineByKey && !mineByCreator) continue;
    if (sp.hostRelay === liveUrl && sp.relayPubkey === pubkey) continue; // already current

    const updated = { ...sp, hostRelay: liveUrl, relayPubkey: pubkey };
    store.dispatch(updateSpace(updated));
    void updateSpaceInStore(updated).catch(() => {});
    log.info(
      `re-pointed self-hosted space ${sp.id} → ${liveUrl} (was host=${sp.hostRelay}, key=${sp.relayPubkey} → ${pubkey})`,
    );
  }
}
