import type { UnsignedEvent } from "@/types/nostr";
import { EVENT_KINDS } from "@/types/nostr";
import type { MusicVisibility, ProjectType } from "@/types/music";

interface TrackEventParams {
  title: string;
  artist: string;
  slug: string;
  duration?: number;
  genre?: string;
  audioUrl: string;
  audioHash?: string;
  audioSize?: number;
  audioMime?: string;
  imageUrl?: string;
  imageMime?: string;
  hashtags?: string[];
  albumRef?: string;
  license?: string;
  featuredArtists?: string[];
  visibility?: MusicVisibility;
  spaceId?: string;
}

interface AlbumEventParams {
  title: string;
  artist: string;
  slug: string;
  genre?: string;
  imageUrl?: string;
  imageMime?: string;
  trackRefs?: string[];
  featuredArtists?: string[];
  projectType?: ProjectType;
  visibility?: MusicVisibility;
  spaceId?: string;
}

interface PlaylistEventParams {
  title: string;
  description?: string;
  slug: string;
  imageUrl?: string;
  trackRefs?: string[];
  visibility?: MusicVisibility;
  spaceId?: string;
}

/** Append visibility-related tags */
function addVisibilityTags(tags: string[][], visibility?: MusicVisibility, spaceId?: string) {
  if (visibility === "unlisted") {
    tags.push(["visibility", "unlisted"]);
  } else if (visibility === "space" && spaceId) {
    tags.push(["h", spaceId]);
  }
  // "public" = no extra tag (default), "local" = not published so no tag needed
}

export function buildTrackEvent(
  pubkey: string,
  params: TrackEventParams,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", params.slug],
    ["title", params.title],
    ["artist", params.artist],
  ];

  if (params.duration !== undefined) {
    tags.push(["duration", String(Math.round(params.duration))]);
  }
  if (params.genre) tags.push(["genre", params.genre]);
  if (params.imageUrl) tags.push(["image", params.imageUrl]);
  if (params.license) tags.push(["license", params.license]);
  if (params.albumRef) tags.push(["a", params.albumRef]);

  // Featured artists as p-tags
  if (params.featuredArtists) {
    for (const npub of params.featuredArtists) {
      tags.push(["p", npub]);
    }
  }

  // imeta tag for audio file
  const imetaParts = [`url ${params.audioUrl}`];
  imetaParts.push(`m ${params.audioMime ?? "audio/mpeg"}`);
  if (params.audioHash) imetaParts.push(`x ${params.audioHash}`);
  if (params.audioSize) imetaParts.push(`size ${params.audioSize}`);
  if (params.duration !== undefined) imetaParts.push(`duration ${params.duration}`);
  tags.push(["imeta", ...imetaParts]);

  if (params.hashtags) {
    for (const t of params.hashtags) {
      tags.push(["t", t.toLowerCase()]);
    }
  }

  addVisibilityTags(tags, params.visibility, params.spaceId);

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.MUSIC_TRACK,
    tags,
    content: "",
  };
}

export function buildAlbumEvent(
  pubkey: string,
  params: AlbumEventParams,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", params.slug],
    ["title", params.title],
    ["artist", params.artist],
  ];

  if (params.genre) tags.push(["genre", params.genre]);
  if (params.imageUrl) tags.push(["image", params.imageUrl]);
  if (params.projectType && params.projectType !== "album") {
    tags.push(["project_type", params.projectType]);
  }

  // Featured artists as p-tags
  if (params.featuredArtists) {
    for (const npub of params.featuredArtists) {
      tags.push(["p", npub]);
    }
  }

  if (params.trackRefs) {
    for (const ref of params.trackRefs) {
      tags.push(["a", ref]);
    }
  }

  addVisibilityTags(tags, params.visibility, params.spaceId);

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.MUSIC_ALBUM,
    tags,
    content: "",
  };
}

export function buildPlaylistEvent(
  pubkey: string,
  params: PlaylistEventParams,
): UnsignedEvent {
  const tags: string[][] = [
    ["d", params.slug],
    ["title", params.title],
  ];

  if (params.imageUrl) tags.push(["image", params.imageUrl]);

  if (params.trackRefs) {
    for (const ref of params.trackRefs) {
      tags.push(["a", ref]);
    }
  }

  addVisibilityTags(tags, params.visibility, params.spaceId);

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.MUSIC_PLAYLIST,
    tags,
    content: params.description ?? "",
  };
}
