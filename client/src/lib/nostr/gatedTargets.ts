import { APP_RELAY } from "./constants";
import { resolveRelaySet } from "@/features/spaces/relaySet";

/**
 * Publish-side guard for protected ("gated") events — the client half of
 * docs/MUSIC_VISIBILITY.md. An event is gated when it carries a valued
 * `["h", <spaceId>]` tag (space-scoped) or a valued `["visibility", …]` tag
 * (private/unlisted). Such an event must never default to the user's public
 * write relays (relay.damus.io, nos.lol, …): the relays that enforce the gate
 * are the listed spaces' host relays (+ mirrors) and the app relay, so when a
 * caller passes no explicit targets those are what it goes to.
 *
 * Explicit `targetRelays` always win — callers that already resolved a space's
 * host (uploads, chat, share-to-space) are untouched.
 */

export type GatedSpaceLookup = ReadonlyArray<{
  id: string;
  hostRelay: string;
  relayUrls?: string[];
}>;

/** Does this tag set mark the event as protected (space-scoped or private)? */
export function isGatedTags(tags: ReadonlyArray<ReadonlyArray<string>>): boolean {
  return tags.some((t) => (t[0] === "h" || t[0] === "visibility") && !!t[1]);
}

/** Every valued `h` tag, deduped, in tag order. */
export function gatedSpaceIds(tags: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] === "h" && t[1] && !out.includes(t[1])) out.push(t[1]);
  }
  return out;
}

/**
 * Relays a gated event may go to when the caller named none: the app relay
 * plus the host relay set of every listed space the client knows. An event
 * whose spaces are all unknown (hosted elsewhere, or the user left them) still
 * goes to the app relay only — never to public relays.
 */
export function gatedTargetRelays(
  tags: ReadonlyArray<ReadonlyArray<string>>,
  spaces: GatedSpaceLookup,
): string[] {
  const out = new Set<string>([APP_RELAY]);
  for (const id of gatedSpaceIds(tags)) {
    const space = spaces.find((s) => s.id === id);
    if (!space) continue;
    for (const url of resolveRelaySet(space)) out.add(url);
  }
  return [...out];
}

/**
 * The relays a publish should use: the caller's explicit list if given; the
 * gated set for a protected event; `undefined` (default write relays) for a
 * public one.
 */
export function resolvePublishTargets(
  tags: ReadonlyArray<ReadonlyArray<string>>,
  targetRelays: string[] | undefined,
  spaces: GatedSpaceLookup,
): string[] | undefined {
  if (targetRelays) return targetRelays;
  if (!isGatedTags(tags)) return undefined;
  return gatedTargetRelays(tags, spaces);
}
