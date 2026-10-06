/**
 * The shelf: one ordered list for a music channel, merged from two legs —
 * members' releases the placement rules put in the channel's feed, and
 * kind-9 posts members made INTO the channel (musicChannelPost.ts). A post
 * of a release that's already listed attaches attribution to that row
 * instead of duplicating it; two posts of the same provider link collapse
 * the same way. Pure; mirrors soot `lib/music/shelf.ts` so both clients show
 * the same rows for the same channel.
 */
import type { MusicAlbum, MusicTrack } from "@/types/music";
import type { NostrEvent } from "@/types/nostr";
import { parseContent } from "@/lib/content/parseContent";
import {
  externalMediaKey,
  findMusicEmbedInText,
  matchMusicEmbed,
  type ExternalMediaItem,
} from "@/lib/content/musicEmbeds";

export interface ShelfAttribution {
  pubkey: string;
  /** created_at of the post, unix seconds. */
  at: number;
  eventId: string;
  note?: string;
}

interface ShelfBase {
  key: string;
  /** Sort anchor: the release's created_at, bumped by any post of it. */
  at: number;
  /** Members who posted this here, oldest first. Empty = listed because its
   *  author is a member (an "all" channel) or it was uploaded into the channel. */
  postedBy: ShelfAttribution[];
}

export type ShelfItem =
  | (ShelfBase & { kind: "track"; track: MusicTrack })
  | (ShelfBase & { kind: "album"; album: MusicAlbum })
  | (ShelfBase & { kind: "external"; media: ExternalMediaItem })
  | (ShelfBase & { kind: "pending"; addressableId: string; refKind: number });

export interface MusicChannelPost {
  /** `${kind}:${pubkey}:${d}` of the referenced release. */
  ref?: string;
  media?: ExternalMediaItem;
  note: string;
}

const MUSIC_REF_KINDS = new Set([31683, 33123]);
const NOSTR_REF_RE = /nostr:(?:naddr1|nevent1|note1)[02-9ac-hj-np-z]+/gi;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

/** The note = the content minus the ref/url it carries, trimmed. */
function noteFrom(content: string): string {
  return content.replace(NOSTR_REF_RE, "").replace(URL_RE, "").replace(/\s+/g, " ").trim();
}

function musicRef(addr: string): string | null {
  const parts = addr.split(":");
  if (parts.length < 3) return null;
  const kind = parseInt(parts[0], 10);
  if (!MUSIC_REF_KINDS.has(kind) || !/^[0-9a-f]{64}$/i.test(parts[1])) return null;
  return addr;
}

/**
 * Read a kind-9 as a shelf post. Tags first (`a` / `r`, what our builder
 * writes), then the content (a plain naddr share, or a provider link someone
 * pasted into the channel by hand). Null = an ordinary message, not a post.
 */
export function parseMusicChannelPost(event: NostrEvent): MusicChannelPost | null {
  if (event.kind !== 9) return null;
  const note = noteFrom(event.content);

  const aTag = tagValue(event, "a");
  if (aTag) {
    const ref = musicRef(aTag);
    if (ref) return { ref, note };
  }
  const rTag = tagValue(event, "r");
  if (rTag) {
    const media = matchMusicEmbed(rTag);
    if (media) return { media, note };
  }
  for (const segment of parseContent(event.content)) {
    if (segment.type === "addr-ref" && MUSIC_REF_KINDS.has(segment.kind)) {
      return { ref: `${segment.kind}:${segment.pubkey}:${segment.identifier}`, note };
    }
  }
  const media = findMusicEmbedInText(event.content);
  if (media) return { media, note };
  return null;
}

export interface BuildShelfInput {
  /** Members' releases placed in this channel (the feed leg), any order. */
  tracks: MusicTrack[];
  albums: MusicAlbum[];
  /** kind-9 events indexed under `${space}:${musicChannelId}`. */
  posts: NostrEvent[];
  /** Catalog — resolves posted refs that aren't in the feed leg. */
  resolvedTracks: Record<string, MusicTrack>;
  resolvedAlbums: Record<string, MusicAlbum>;
  /** Pubkeys whose posts are ignored (mute list). */
  muted?: ReadonlySet<string>;
  /** Post ids removed (own delete, or a kind 5 seen). */
  removedPosts?: Record<string, true>;
  /** The channel's space — a posted release must be allowed here (never
   *  private; a space-exclusive one must include this space). */
  spaceId?: string;
}

/** The `h`/visibility rule for a release on a shelf: never private or
 *  unlisted; space-exclusive only where the space is listed. */
export function isReleaseAllowedInSpace(
  item: Pick<MusicTrack | MusicAlbum, "visibility" | "spaceIds">,
  spaceId: string | undefined,
): boolean {
  if (item.visibility === "private" || item.visibility === "local") return false;
  if (item.visibility === "space") return !spaceId || item.spaceIds.includes(spaceId);
  return true;
}

/** Merge both legs into keyed rows (insertion order; sort separately). */
export function buildShelf(input: BuildShelfInput): ShelfItem[] {
  const rows = new Map<string, ShelfItem>();

  for (const track of input.tracks) {
    if (!isReleaseAllowedInSpace(track, input.spaceId)) continue;
    rows.set(track.addressableId, { kind: "track", key: track.addressableId, track, at: track.createdAt, postedBy: [] });
  }
  for (const album of input.albums) {
    if (!isReleaseAllowedInSpace(album, input.spaceId)) continue;
    rows.set(album.addressableId, { kind: "album", key: album.addressableId, album, at: album.createdAt, postedBy: [] });
  }

  const posts = [...input.posts].sort((a, b) => a.created_at - b.created_at);
  for (const post of posts) {
    if (input.muted?.has(post.pubkey)) continue;
    if (input.removedPosts?.[post.id]) continue;
    const parsed = parseMusicChannelPost(post);
    if (!parsed) continue;
    const attribution: ShelfAttribution = {
      pubkey: post.pubkey,
      at: post.created_at,
      eventId: post.id,
      ...(parsed.note ? { note: parsed.note } : {}),
    };

    if (parsed.ref) {
      const key = parsed.ref;
      const existing = rows.get(key);
      if (existing) {
        existing.postedBy.push(attribution);
        existing.at = Math.max(existing.at, post.created_at);
        continue;
      }
      const track = input.resolvedTracks[key];
      if (track) {
        if (!isReleaseAllowedInSpace(track, input.spaceId)) continue;
        rows.set(key, { kind: "track", key, track, at: post.created_at, postedBy: [attribution] });
        continue;
      }
      const album = input.resolvedAlbums[key];
      if (album) {
        if (!isReleaseAllowedInSpace(album, input.spaceId)) continue;
        rows.set(key, { kind: "album", key, album, at: post.created_at, postedBy: [attribution] });
        continue;
      }
      rows.set(key, {
        kind: "pending",
        key,
        addressableId: key,
        refKind: parseInt(key.split(":")[0], 10),
        at: post.created_at,
        postedBy: [attribution],
      });
      continue;
    }

    if (parsed.media) {
      const key = externalMediaKey(parsed.media.canonicalUrl);
      const existing = rows.get(key);
      if (existing) {
        existing.postedBy.push(attribution);
        existing.at = Math.max(existing.at, post.created_at);
        continue;
      }
      rows.set(key, { kind: "external", key, media: parsed.media, at: post.created_at, postedBy: [attribution] });
    }
  }

  return [...rows.values()];
}

/**
 * The library's rule for one mixed grid: a project card stands for its
 * tracks, so a track folds into its project when that project is on the
 * shelf too. A track someone POSTED stays — the attribution is the point of
 * that row — and so does a loose single. "Tracks" still lists every track;
 * play-all still queues them all.
 */
export function collapseMemberTracks(items: ShelfItem[]): ShelfItem[] {
  const projects = new Set<string>();
  for (const row of items) if (row.kind === "album") projects.add(row.album.addressableId);
  if (projects.size === 0) return items;
  return items.filter(
    (row) =>
      row.kind !== "track" ||
      !row.track.albumRef ||
      !projects.has(row.track.albumRef) ||
      row.postedBy.length > 0,
  );
}

/** Newest first by the row's anchor (release time, bumped by posts). */
export function sortShelfNewest(items: ShelfItem[]): ShelfItem[] {
  return [...items].sort((a, b) => b.at - a.at);
}

export function lastPostAt(row: ShelfItem): number {
  let last = 0;
  for (const p of row.postedBy) if (p.at > last) last = p.at;
  return last;
}

/** Playable tracks in shelf order — the "play all" queue. */
export function shelfTrackIds(items: ShelfItem[]): string[] {
  const out: string[] = [];
  for (const row of items) if (row.kind === "track") out.push(row.track.addressableId);
  return out;
}

/** Addressable ids posted here that the catalog hasn't resolved yet. */
export function pendingRefs(items: ShelfItem[]): string[] {
  return items.filter((r): r is Extract<ShelfItem, { kind: "pending" }> => r.kind === "pending").map((r) => r.addressableId);
}
