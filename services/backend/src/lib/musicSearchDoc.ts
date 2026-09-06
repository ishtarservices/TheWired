/**
 * Single source of truth for the Meilisearch document shape of music events
 * (tracks index ← kind 31683, albums index ← kind 33123). Used by BOTH the live
 * ingest path (workers/ingestHandlers.ts) and the full-reindex path
 * (musicService.rebuildCounts) so a rebuild can never silently produce narrower
 * documents than live ingest (e.g. dropping artist_pubkeys/featured_pubkeys and
 * degrading artist filtering).
 */

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
  };
}
