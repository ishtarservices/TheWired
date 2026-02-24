import type { ImetaVariant } from "./media";

export type MusicVisibility = "public" | "unlisted" | "space" | "local";

export type ProjectType = "album" | "ep" | "demo" | "mix" | "other";

/** Parsed music track from kind:31683 event */
export interface MusicTrack {
  addressableId: string; // `31683:${pubkey}:${dTag}`
  eventId: string;
  pubkey: string;
  title: string;
  artist: string;
  featuredArtists: string[]; // pubkeys of featured/collaborating artists (from p-tags)
  albumRef?: string; // addressable ID of parent album
  duration?: number; // seconds
  genre?: string;
  hashtags: string[];
  variants: ImetaVariant[];
  imageUrl?: string;
  blurhash?: string;
  createdAt: number;
  license?: string;
  visibility: MusicVisibility;
}

/** Parsed music album/project from kind:33123 event */
export interface MusicAlbum {
  addressableId: string; // `33123:${pubkey}:${dTag}`
  eventId: string;
  pubkey: string;
  title: string;
  artist: string;
  featuredArtists: string[]; // pubkeys of featured/collaborating artists (from p-tags)
  projectType: ProjectType;
  imageUrl?: string;
  blurhash?: string;
  genre?: string;
  trackRefs: string[]; // ordered addressable IDs of tracks
  trackCount: number;
  totalDuration?: number;
  createdAt: number;
  visibility: MusicVisibility;
}

/** Parsed music playlist from kind:30119 event */
export interface MusicPlaylist {
  addressableId: string; // `30119:${pubkey}:${dTag}`
  eventId: string;
  pubkey: string;
  title: string;
  description?: string;
  imageUrl?: string;
  trackRefs: string[]; // ordered addressable IDs of tracks
  createdAt: number;
  visibility: MusicVisibility;
}

export type MusicView =
  | "home"
  | "recently-added"
  | "artists"
  | "albums"
  | "songs"
  | "playlists"
  | "my-uploads"
  | "artist-detail"
  | "album-detail"
  | "playlist-detail";

export type RepeatMode = "none" | "one" | "all";
