import { store } from "@/store";
import { relayManager } from "@/lib/nostr/relayManager";

/**
 * Resolve the target relays for a space-visibility music publish: the space's
 * host relay, pre-connected so the publish doesn't race the socket open. Space
 * members subscribe on the host relay, so an `h`-tagged event published only to
 * the user's write relays never reaches them (share-to-space already targets the
 * host relay — uploads must too). Returns undefined (default write relays) when
 * the space is unknown, so the publish still happens rather than silently
 * dropping.
 */
export async function spacePublishRelays(
  spaceId: string | undefined,
): Promise<string[] | undefined> {
  if (!spaceId) return undefined;
  const space = store.getState().spaces.list.find((s) => s.id === spaceId);
  const hostRelay = space?.hostRelay;
  if (!hostRelay) return undefined;

  relayManager.connect(hostRelay, "read+write");
  try {
    await relayManager.waitForConnection(hostRelay, 5000);
  } catch {
    // Publish anyway — the outbox replays un-acked events on reconnect.
  }
  return [hostRelay];
}
