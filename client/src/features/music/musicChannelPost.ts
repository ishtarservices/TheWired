/**
 * A post INTO a music channel — the wire shape desktop and soot agree on
 * (soot `lib/music/musicChannelPost.ts`). A kind-9 (the channel carrier the
 * relay already membership-gates by `h`) tagged with the MUSIC channel's id,
 * carrying either a release ref or an external link, plus an optional note:
 *
 *   content: "nostr:naddr1…"  | "https://…"      (+ "\n\n<note>")
 *   tags:    ["a", "<kind>:<pubkey>:<d>"], ["k", "<kind>"]   (release)
 *            ["r", "<canonical url>"]                        (link)
 *            ["p", <release author>, "", "artist"]  when not the poster
 *
 * `buildChatMessage` adds `h` + `channel`. The tags are the cheap match key
 * (shelf.ts); the content is what a client that knows nothing of shelves
 * (chat, a NIP-29 client) still renders sensibly.
 */
import type { MusicAlbum, MusicTrack } from "@/types/music";
import type { UnsignedEvent } from "@/types/nostr";
import { buildChatMessage } from "@/lib/nostr/eventBuilder";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import { matchMusicEmbed, type ExternalMediaItem } from "@/lib/content/musicEmbeds";

export type MusicPostTarget =
  | { kind: "track"; track: MusicTrack }
  | { kind: "album"; album: MusicAlbum }
  | { kind: "external"; media: ExternalMediaItem };

export interface MusicChannelPostBody {
  content: string;
  /** Extra tags — never `h`/`channel` (the chat builder owns those). */
  tags: string[][];
}

function withNote(lead: string, note: string | undefined): string {
  const trimmed = note?.trim();
  return trimmed ? `${lead}\n\n${trimmed}` : lead;
}

export function buildMusicChannelPost(
  target: MusicPostTarget,
  opts: { note?: string; posterPubkey: string },
): MusicChannelPostBody {
  if (target.kind === "external") {
    const media = matchMusicEmbed(target.media.url) ?? target.media;
    return { content: withNote(media.canonicalUrl, opts.note), tags: [["r", media.canonicalUrl]] };
  }
  const item = target.kind === "track" ? target.track : target.album;
  const kind = target.kind === "track" ? 31683 : 33123;
  const tags: string[][] = [
    ["a", item.addressableId],
    ["k", String(kind)],
  ];
  if (item.pubkey !== opts.posterPubkey) tags.push(["p", item.pubkey, "", "artist"]);
  return { content: withNote(buildNaddrReference(item.addressableId), opts.note), tags };
}

/** The signed-ready kind-9 for a shelf post into `channelId` of `spaceId`. */
export function buildMusicChannelPostEvent(
  posterPubkey: string,
  spaceId: string,
  channelId: string,
  target: MusicPostTarget,
  note?: string,
): UnsignedEvent {
  const body = buildMusicChannelPost(target, { note, posterPubkey });
  const unsigned = buildChatMessage(posterPubkey, spaceId, body.content, undefined, channelId);
  unsigned.tags.push(...body.tags);
  return unsigned;
}

/**
 * Can a member post this release into one of `spaceId`'s music channels?
 * Public releases, and space-exclusive ones that include this space; a
 * private release would render as an unplayable card for everyone else.
 * Returns the reason it can't, or null when it can.
 */
export function releaseShareBlockReason(
  item: Pick<MusicTrack | MusicAlbum, "visibility" | "spaceIds">,
  spaceId: string,
): string | null {
  if (item.visibility === "private") return "private";
  if (item.visibility === "local") return "not published";
  if (item.visibility === "space" && !item.spaceIds.includes(spaceId)) return "another space only";
  return null;
}
