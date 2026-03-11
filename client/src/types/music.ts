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
  artistPubkeys: string[]; // pubkeys explicitly tagged as artist role (from p-tags with role "artist")
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
  sharingDisabled?: boolean;
  revisionSummary?: string;
}

/** Parsed music album/project from kind:33123 event */
export interface MusicAlbum {
  addressableId: string; // `33123:${pubkey}:${dTag}`
  eventId: string;
  pubkey: string;
  title: string;
  artist: string;
  artistPubkeys: string[]; // pubkeys explicitly tagged as artist role
  featuredArtists: string[]; // pubkeys of featured/collaborating artists (from p-tags)
  projectType: ProjectType;
  imageUrl?: string;
  blurhash?: string;
  genre?: string;
  trackRefs: string[]; // ordered addressable IDs of tracks
  hashtags: string[];
  trackCount: number;
  totalDuration?: number;
  createdAt: number;
  visibility: MusicVisibility;
  sharingDisabled?: boolean;
  revisionSummary?: string;
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
  | "favorites"
  | "artists"
  | "albums"
  | "songs"
  | "playlists"
  | "my-uploads"
  | "artist-detail"
  | "album-detail"
  | "playlist-detail"
  | "explore"
  | "for-you"
  | "search"
  | "project-history"
  | "project-proposals"
  | "insights";

/** Entry in the unified artist directory */
export type ArtistEntry =
  | { type: "pubkey"; pubkey: string; trackCount: number; albumCount: number }
  | { type: "name"; name: string; normalizedName: string; trackCount: number; albumCount: number };

export type RepeatMode = "none" | "one" | "all";

/** Track notes (kind:31686) */
export interface TrackNotes {
  addressableId: string;
  trackRef: string;
  linerNotes?: string;
  productionNotes?: string;
  credits: TrackCredit[];
  createdAt: number;
}

export interface TrackCredit {
  role: string;
  name: string;
  pubkey?: string;
}

/** A single revision in the project timeline */
export interface MusicRevision {
  version: number;
  eventId: string;
  createdAt: number;
  summary?: string;
  changes: RevisionChange[];
}

/** Track/album play insights */
export interface TrackInsights {
  totalPlays: number;
  uniqueListeners: number;
  dailyPlays: { date: string; count: number }[];
  trend: "up" | "down" | "stable";
}

export interface ArtistSummary {
  totalPlays: number;
  totalListeners: number;
  trackBreakdown: { addressableId: string; title: string; plays: number }[];
  trackCount: number;
}

export interface RevisionChange {
  type: "audio_replaced" | "track_added" | "track_removed" | "track_reordered" |
        "metadata_changed" | "cover_changed" | "visibility_changed";
  field?: string;
  oldValue?: string;
  newValue?: string;
  trackRef?: string;
}

/** Collaboration proposal change */
export interface ProposalChange {
  type: "add_track" | "remove_track" | "reorder" | "update_metadata";
  trackRef?: string;
  position?: number;
  from?: number;
  to?: number;
  field?: string;
  value?: string;
}

/** Music collaboration proposal (kind:31685) */
export interface MusicProposal {
  id: string;
  proposalId: string;
  targetAlbum: string;
  proposerPubkey: string;
  ownerPubkey: string;
  title: string;
  description?: string;
  changes: ProposalChange[];
  status: "open" | "accepted" | "rejected";
  createdAt: number;
}

/** Saved album version for fan update notifications */
export interface SavedAlbumVersion {
  addressableId: string;
  savedEventId: string;
  savedCreatedAt: number;
  hasUpdate: boolean;
}
