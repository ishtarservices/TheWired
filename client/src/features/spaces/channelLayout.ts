import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { Space, SpaceChannel, SpaceChannelType } from "../../types/space";
import { relayUrlToHost } from "./spaceType";

/**
 * Portable channel-layout overlay (Decentralized Spaces, M4).
 *
 * Vanilla NIP-29 is one chat per group; Discord-style categories + channels are
 * an overlay stored in a kind:30078 (NIP-78) event — the same approach Obelisk
 * uses. We publish our own `wired:layout:<groupId>` event and also READ Obelisk's
 * `obelisk:layout:<relayUrl>` so a Wired user importing an Obelisk server sees
 * its channel tree.
 *
 * Trust: the layout is authoritative only from the group's admins / creator /
 * the relay's signing key — a kind:30078 from anyone else is ignored.
 */

const VALID_TYPES: ReadonlySet<string> = new Set<SpaceChannelType>([
  "chat",
  "notes",
  "media",
  "articles",
  "music",
  "voice",
  "video",
]);

/** d-tag for our own layout event. */
export function wiredLayoutDTag(groupId: string): string {
  return `wired:layout:${groupId}`;
}

/** d-tag Obelisk uses (keyed by relay URL, not group id). */
export function obeliskLayoutDTag(hostRelay: string): string {
  return `obelisk:layout:${hostRelay}`;
}

/** The d-tags we subscribe to for a native space's layout (ours + Obelisk's). */
export function layoutDTags(space: Pick<Space, "id" | "hostRelay">): string[] {
  return [
    wiredLayoutDTag(space.id),
    obeliskLayoutDTag(space.hostRelay),
    // Obelisk also seen with a bare-host form.
    obeliskLayoutDTag(`wss://${relayUrlToHost(space.hostRelay)}`),
  ];
}

/**
 * Build our kind:30078 layout event.
 * Tags: ["category", catId, name, position], ["channel", channelId, type, label, catId, position].
 */
export function buildLayoutEvent(
  pubkey: string,
  groupId: string,
  channels: SpaceChannel[],
): UnsignedEvent {
  const tags: string[][] = [
    ["d", wiredLayoutDTag(groupId)],
    ["alt", "Channel layout for a The Wired space"],
  ];

  const categories = new Map<string, string>();
  for (const ch of channels) {
    if (ch.categoryId && !categories.has(ch.categoryId)) {
      categories.set(ch.categoryId, ch.categoryId);
    }
  }
  let pos = 0;
  for (const catId of categories.keys()) {
    tags.push(["category", catId, catId, String(pos++)]);
  }
  channels.forEach((ch, i) => {
    tags.push(["channel", ch.id, ch.type, ch.label, ch.categoryId ?? "", String(ch.position ?? i)]);
  });

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags,
    content: "",
  };
}

/** Map a foreign (Obelisk) channel type onto ours. */
function mapType(raw: string | undefined): SpaceChannelType {
  switch (raw) {
    case "text":
      return "chat";
    case "voice":
    case "voice-sfu":
      return "voice";
    case "forum":
      return "notes";
    default:
      return VALID_TYPES.has(raw ?? "") ? (raw as SpaceChannelType) : "chat";
  }
}

/** Who may author a binding layout for this space. */
function authorizedAuthors(space: Space): Set<string> {
  const set = new Set<string>(space.adminPubkeys);
  if (space.creatorPubkey) set.add(space.creatorPubkey);
  if (space.relayPubkey) set.add(space.relayPubkey);
  return set;
}

/**
 * Parse a kind:30078 layout event into channels for `space`, or null if the
 * event isn't an authorized layout for it. Sanitizes labels/types.
 */
export function parseLayoutEvent(event: NostrEvent, space: Space): SpaceChannel[] | null {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d) return null;

  const isWired = d === wiredLayoutDTag(space.id);
  const isObelisk = d.startsWith("obelisk:layout:");
  if (!isWired && !isObelisk) return null;

  // SECURITY: the layout is only trustworthy from the group's authority.
  if (!authorizedAuthors(space).has(event.pubkey)) return null;

  const channels: SpaceChannel[] = [];
  let i = 0;
  for (const tag of event.tags) {
    if (tag[0] !== "channel" || !tag[1]) continue;
    const id = String(tag[1]).slice(0, 64);
    let type: SpaceChannelType;
    let label: string;
    let categoryId: string | undefined;
    let position: number;

    if (isWired) {
      // ["channel", id, type, label, catId, position]
      type = mapType(tag[2]);
      label = (tag[3] || `#${id}`).slice(0, 64);
      categoryId = tag[4] || undefined;
      position = Number.parseInt(tag[5] ?? "", 10);
    } else {
      // Obelisk: ["channel", id, catId, position] — type via a sibling "t" tag
      // is fuzzy across versions, so default to chat and map if present.
      type = mapType(tag[4]);
      label = `#${id}`;
      categoryId = tag[2] || undefined;
      position = Number.parseInt(tag[3] ?? "", 10);
    }

    channels.push({
      id,
      spaceId: space.id,
      type,
      label,
      categoryId,
      position: Number.isFinite(position) ? position : i,
      isDefault: i === 0,
      adminOnly: false,
      slowModeSeconds: 0,
      feedMode: "all",
    });
    i += 1;
  }

  if (channels.length === 0) return null;
  // Ensure exactly one default (first by position).
  channels.sort((a, b) => a.position - b.position);
  channels.forEach((c, idx) => (c.isDefault = idx === 0));
  return channels;
}
