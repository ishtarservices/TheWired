import { store } from "@/store";
import { relayManager } from "@/lib/nostr/relayManager";
import { APP_RELAY } from "@/lib/nostr/constants";
import { resolveRelaySet } from "@/features/spaces/relaySet";

/**
 * Resolve the target relays for a space-visibility music publish: the space's
 * host relay set (host + mirrors, like chat's `resolveRelaySet`), pre-connected
 * so the publish doesn't race the socket open. Space members subscribe on the
 * host relay, so an `h`-tagged event published only to the user's write relays
 * never reaches them. When the space is unknown (left it, or hosted elsewhere)
 * the event goes to the app relay only — never to the public write relays, as
 * that would leak a members-only release (docs/MUSIC_VISIBILITY.md). The
 * publish chokepoint (lib/nostr/publish.ts) applies the same rule when a
 * caller passes no targets at all.
 */
export async function spacePublishRelays(
  spaceId: string | undefined,
): Promise<string[] | undefined> {
  if (!spaceId) return undefined;
  const space = store.getState().spaces.list.find((s) => s.id === spaceId);
  const relays = space?.hostRelay ? resolveRelaySet(space) : [APP_RELAY];

  for (const url of relays) relayManager.connect(url, "read+write");
  try {
    await relayManager.waitForConnection(relays[0], 5000);
  } catch {
    // Publish anyway — the outbox replays un-acked events on reconnect.
  }
  return relays;
}

/**
 * Host relays for an event shared into several spaces (one `h` tag each),
 * deduped. Undefined only when `spaceIds` is empty (the publish chokepoint
 * then decides); an unknown space contributes the app relay, never the
 * default write relays.
 */
export async function spacePublishRelaysForAll(
  spaceIds: readonly string[],
): Promise<string[] | undefined> {
  const out = new Set<string>();
  for (const id of new Set(spaceIds)) {
    for (const url of (await spacePublishRelays(id)) ?? []) out.add(url);
  }
  return out.size > 0 ? [...out] : undefined;
}
