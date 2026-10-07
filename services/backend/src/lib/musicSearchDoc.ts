/**
 * Single source of truth for the Meilisearch document shape of music events
 * (tracks index ← kind 31683, albums index ← kind 33123). Used by BOTH the live
 * ingest path (workers/ingestHandlers.ts) and the full-reindex path
 * (musicService.rebuildCounts) so a rebuild can never silently produce narrower
 * documents than live ingest (e.g. dropping artist_pubkeys/featured_pubkeys and
 * degrading artist filtering).
 */

import { isUnlisted } from "./musicListing.js";

export interface MusicEventLike {
  id: string;
  pubkey: string;
  created_at: number;
  tags: string[][];
}

export interface MusicSearchDoc {
  id: string;
  addressable_id: string;
  title: string;
  artist: string;
  genre: string;
  image_url: string;
  hashtags: string[];
  pubkey: string;
  artist_pubkeys: string[];
  featured_pubkeys: string[];
  created_at: number;
  /**
   * `["catalog","none"]` tracks stay IN the index (insights enumerate an
   * artist's tracks from here, and an unlisted clip's play counts still belong
   * to its owner) but are filtered out of browse/search at query time with
   * MS_LISTED_FILTER. Albums never carry the tag, so this is always false there.
   */
  unlisted: boolean;
}

function tagValue(tags: string[][], name: string): string | undefined {
  return tags.find((t) => t[0] === name)?.[1];
}

export function buildMusicSearchDoc(event: MusicEventLike, kind: 31683 | 33123): MusicSearchDoc {
  const tags = event.tags;
  const dTag = tagValue(tags, "d") ?? "";
  const hashtags = tags.filter((t) => t[0] === "t").map((t) => t[1]);

  const pTags = tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoles = pTags.some((t) => t[3]);
  const artistPubkeys = hasRoles ? pTags.filter((t) => t[3] === "artist").map((t) => t[1]) : [];
  const featuredPubkeys = hasRoles
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);

  return {
    id: event.id,
    addressable_id: `${kind}:${event.pubkey}:${dTag}`,
    title: tagValue(tags, "title") ?? "",
    artist: tagValue(tags, "artist") ?? "",
    genre: tagValue(tags, "genre") ?? "",
    image_url: tagValue(tags, "image") ?? tagValue(tags, "thumb") ?? "",
    hashtags,
    pubkey: event.pubkey,
    artist_pubkeys: artistPubkeys,
    featured_pubkeys: featuredPubkeys,
    created_at: event.created_at,
    unlisted: isUnlisted(tags),
  };
}

/**
 * One hit per release address: the newest version, at the best-ranked
 * position. Docs are keyed by event id. Ingest keeps one doc per address, but
 * an index written before it did (or a write Meilisearch has not applied yet)
 * can still hold older versions of a release.
 */
export function newestPerAddress<T extends Record<string, unknown>>(hits: T[]): T[] {
  const newest = new Map<string, T>();
  for (const h of hits) {
    const addr = h.addressable_id as string | undefined;
    if (!addr) continue;
    const cur = newest.get(addr);
    if (!cur || (h.created_at as number) > (cur.created_at as number)) newest.set(addr, h);
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of hits) {
    const addr = h.addressable_id as string | undefined;
    if (!addr) {
      out.push(h);
    } else if (!seen.has(addr)) {
      seen.add(addr);
      out.push(newest.get(addr)!);
    }
  }
  return out;
}
