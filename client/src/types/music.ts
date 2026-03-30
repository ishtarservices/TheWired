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
  // | "project-proposals" // TODO: re-enable proposals/changes system later
  | "insights";

/** Entry in the unified artist directory */
export type ArtistEntry =
  | { type: "pubkey"; pubkey: string; trackCount: number; albumCount: number }
  | { type: "name"; name: string; normalizedName: string; trackCount: number; albumCount: number };

export type RepeatMode = "none" | "one" | "all";

/** A freeform annotation attached to a track or album (kind:31686) */
export interface MusicAnnotation {
  /** Addressable ID of this annotation event: 31686:pubkey:dTag */
  addressableId: string;
  /** Raw event ID (hex hash) — needed for reposts and quotes */
  eventId: string;
  /** Addressable ID of the target track (31683:...) or album (33123:...) */
  targetRef: string;
  /** Author of this annotation */
  authorPubkey: string;
  /** Freeform markdown content */
  content: string;
  /** Optional soft label for display grouping */
  label?: AnnotationLabel;
  /** Custom label text when label is "custom" */
  customLabel?: string;
  /** Whether this annotation is private (only visible to the author) */
  isPrivate: boolean;
  /** Whether this annotation is pinned to the top */
  isPinned: boolean;
  /** Space ID if this annotation is space-scoped */
  spaceId?: string;
  createdAt: number;
}

export type AnnotationLabel =
  | "story"
  | "credits"
  | "thanks"
  | "process"
  | "lyrics"
  | "custom";

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
