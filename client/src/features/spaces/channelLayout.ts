import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { Space, SpaceChannel, SpaceChannelCategory, SpaceChannelType } from "../../types/space";
import { relayUrlToHost } from "./spaceType";
import { stripInvisible } from "./channelTree";

/**
 * Portable channel-layout overlay for relay-only (NIP-29-native) spaces.
 * Contract: docs/CHANNEL_LAYOUT.md ("Relay-only spaces").
 *
 * Vanilla NIP-29 is one chat per group; categories + channels are an overlay
 * stored in a kind:30078 (NIP-78) event — the same approach Obelisk uses. We
 * publish our own `wired:layout:<groupId>` event (h-tagged, so only members can
 * read it and hosted-only relays accept it) and also READ Obelisk's
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

const MAX_CHANNELS = 200;
const MAX_CATEGORIES = 50;
const MAX_ID = 64;
const MAX_TEXT = 64;
/** Relays reject events dated further ahead than this. */
const MAX_FUTURE_SECONDS = 15 * 60;

/** The channel id untagged kind-9s from other NIP-29 clients land in. */
export const NATIVE_DEFAULT_CHAT_ID = "chat";

/** d-tag for our own layout event. */
export function wiredLayoutDTag(groupId: string): string {
  return `wired:layout:${groupId}`;
}

/** d-tag Obelisk uses (keyed by relay URL, not group id). */
export function obeliskLayoutDTag(hostRelay: string): string {
  return `obelisk:layout:${hostRelay}`;
}

/** Obelisk's layout d-tags for a space (it has been seen with both forms). */
export function obeliskLayoutDTags(space: Pick<Space, "hostRelay">): string[] {
  return [obeliskLayoutDTag(space.hostRelay), obeliskLayoutDTag(`wss://${relayUrlToHost(space.hostRelay)}`)];
}

/** The d-tags we read for a native space's layout (ours + Obelisk's). */
export function layoutDTags(space: Pick<Space, "id" | "hostRelay">): string[] {
  return [wiredLayoutDTag(space.id), ...obeliskLayoutDTags(space)];
}

/** Who may author a binding layout for this space. */
export function authorizedLayoutAuthors(space: Space): string[] {
  const set = new Set<string>(space.adminPubkeys);
  if (space.creatorPubkey) set.add(space.creatorPubkey);
  if (space.relayPubkey) set.add(space.relayPubkey);
  return [...set];
}

/** `created_at` for a new layout: strictly after the one it replaces, never too far ahead. */
export function nextLayoutCreatedAt(previous: number | undefined, nowSeconds = Math.floor(Date.now() / 1000)): number {
  return Math.min(Math.max(nowSeconds, (previous ?? 0) + 1), nowSeconds + MAX_FUTURE_SECONDS);
}

/**
 * Build our kind:30078 layout event.
 * Tags: ["h", groupId], ["category", catId, name, position],
 *       ["channel", channelId, type, label, catId, position, feedMode?],
 *       ["default", channelId]
 * `feedMode` is written only when curated, so older readers (which ignore
 * extra positions) and older events agree on "all".
 */
export function buildLayoutEvent(
  pubkey: string,
  groupId: string,
  layout: { channels: SpaceChannel[]; categories: SpaceChannelCategory[]; defaultChannelId?: string },
  createdAt = Math.floor(Date.now() / 1000),
): UnsignedEvent {
  const tags: string[][] = [
    ["d", wiredLayoutDTag(groupId)],
    ["h", groupId],
    ["alt", "Channel layout for a The Wired space"],
  ];
  const categories = [...layout.categories].sort((a, b) => a.position - b.position);
  categories.forEach((c, i) => tags.push(["category", c.id, c.name, String(i)]));

  const channels = [...layout.channels].sort((a, b) => a.position - b.position);
  channels.forEach((ch, i) => {
    const tag = ["channel", ch.id, ch.type, ch.label, ch.categoryId ?? "", String(i)];
    if (ch.feedMode === "curated") tag.push("curated");
    tags.push(tag);
  });

  const defaultId =
    layout.defaultChannelId ?? channels.find((c) => c.isDefault)?.id ?? channels.find((c) => c.id === NATIVE_DEFAULT_CHAT_ID)?.id;
  if (defaultId) tags.push(["default", defaultId]);

  return { pubkey, created_at: createdAt, kind: 30078, tags, content: "" };
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

function cleanId(raw: unknown): string {
  return typeof raw === "string" ? raw.slice(0, MAX_ID) : "";
}

function cleanText(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? stripInvisible(raw).slice(0, MAX_TEXT) : "";
  return text || fallback;
}

export interface ParsedLayout {
  channels: SpaceChannel[];
  categories: SpaceChannelCategory[];
  convention: "wired" | "obelisk";
}

/**
 * Parse a kind:30078 layout event for `space`, or null if it isn't an
 * authorized layout for it. Sanitizes ids, labels, names and types; caps sizes.
 * The default channel comes from the `default` tag, else `chat`, else the
 * first chat channel — never "whatever sorts first", because untagged chat
 * from other NIP-29 clients is routed to it.
 */
export function parseLayoutEvent(event: NostrEvent, space: Space): ParsedLayout | null {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d) return null;

  const isWired = d === wiredLayoutDTag(space.id);
  const isObelisk = obeliskLayoutDTags(space).includes(d);
  if (!isWired && !isObelisk) return null;

  // SECURITY: the layout is only trustworthy from the group's authority.
  if (!authorizedLayoutAuthors(space).includes(event.pubkey)) return null;

  // Categories
  const categories: SpaceChannelCategory[] = [];
  const categoryIds = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "category" || categories.length >= MAX_CATEGORIES) continue;
    const id = cleanId(tag[1]);
    if (!id || categoryIds.has(id)) continue;
    categoryIds.add(id);
    const position = Number.parseInt(tag[3] ?? "", 10);
    categories.push({
      id,
      spaceId: space.id,
      name: cleanText(tag[2], id),
      position: Number.isFinite(position) ? position : categories.length,
    });
  }
  categories.sort((a, b) => a.position - b.position);
  categories.forEach((c, i) => (c.position = i));

  // Channels
  const channels: SpaceChannel[] = [];
  const channelIds = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "channel" || channels.length >= MAX_CHANNELS) continue;
    const id = cleanId(tag[1]);
    if (!id || channelIds.has(id)) continue;
    channelIds.add(id);

    let type: SpaceChannelType;
    let label: string;
    let categoryId: string | null;
    let position: number;
    let feedMode: SpaceChannel["feedMode"] = "all";

    if (isWired) {
      // ["channel", id, type, label, catId, position, feedMode?]
      type = mapType(tag[2]);
      label = cleanText(tag[3], `#${id}`);
      categoryId = cleanId(tag[4]) || null;
      // A reference to a category the event doesn't define is a broken layout
      // entry: show the channel uncategorized rather than invent a folder.
      if (categoryId && !categoryIds.has(categoryId)) categoryId = null;
      position = Number.parseInt(tag[5] ?? "", 10);
      if (tag[6] === "curated") feedMode = "curated";
    } else {
      // Obelisk: ["channel", id, catId, position, type?]. It may not define
      // category names; an undefined id becomes a folder named after it.
      type = mapType(tag[4]);
      label = `#${id}`;
      categoryId = cleanId(tag[2]) || null;
      position = Number.parseInt(tag[3] ?? "", 10);
    }

    channels.push({
      id,
      spaceId: space.id,
      type,
      label,
      categoryId,
      position: Number.isFinite(position) ? position : channels.length,
      isDefault: false,
      adminOnly: false,
      slowModeSeconds: 0,
      feedMode,
    });
  }

  if (channels.length === 0) return null;
  channels.sort((a, b) => a.position - b.position);

  const declared = event.tags.find((t) => t[0] === "default")?.[1];
  const defaultChannel =
    channels.find((c) => c.id === declared) ??
    channels.find((c) => c.id === NATIVE_DEFAULT_CHAT_ID) ??
    channels.find((c) => c.type === "chat") ??
    channels[0];
  defaultChannel.isDefault = true;

  return { channels, categories, convention: isWired ? "wired" : "obelisk" };
}

/**
 * Pick the binding layout among candidate events (each relay keeps one per
 * author): authorized only; ours beats Obelisk's; newest `created_at`; ties
 * broken by the lower event id. Returns the event and its parse, or null.
 */
export function pickLayout(
  candidates: readonly NostrEvent[],
  space: Space,
): { event: NostrEvent; layout: ParsedLayout } | null {
  let best: { event: NostrEvent; layout: ParsedLayout } | null = null;
  for (const event of candidates) {
    const layout = parseLayoutEvent(event, space);
    if (!layout) continue;
    if (!best) {
      best = { event, layout };
      continue;
    }
    const rank = (l: ParsedLayout) => (l.convention === "wired" ? 1 : 0);
    const better =
      rank(layout) > rank(best.layout) ||
      (rank(layout) === rank(best.layout) &&
        (event.created_at > best.event.created_at ||
          (event.created_at === best.event.created_at && event.id < best.event.id)));
    if (better) best = { event, layout };
  }
  return best;
}
