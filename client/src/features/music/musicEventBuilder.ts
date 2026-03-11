import type { UnsignedEvent } from "@/types/nostr";
import { EVENT_KINDS } from "@/types/nostr";
import type { MusicVisibility, ProjectType, ProposalChange } from "@/types/music";

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
  artistPubkeys?: string[];
  featuredArtists?: string[];
  visibility?: MusicVisibility;
  revisionSummary?: string;
  sharingDisabled?: boolean;
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
  artistPubkeys?: string[];
  featuredArtists?: string[];
  hashtags?: string[];
  projectType?: ProjectType;
  visibility?: MusicVisibility;
  revisionSummary?: string;
  sharingDisabled?: boolean;
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

  // Artist identity p-tags (role: "artist")
  if (params.artistPubkeys) {
    for (const pk of params.artistPubkeys) {
      tags.push(["p", pk, "", "artist"]);
    }
  }

  // Featured artists as p-tags (role: "featured")
  if (params.featuredArtists) {
    for (const pk of params.featuredArtists) {
      tags.push(["p", pk, "", "featured"]);
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

  if (params.revisionSummary) {
    tags.push(["revision_summary", params.revisionSummary]);
  }
  if (params.sharingDisabled) {
    tags.push(["sharing", "disabled"]);
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

  // Artist identity p-tags (role: "artist")
  if (params.artistPubkeys) {
    for (const pk of params.artistPubkeys) {
      tags.push(["p", pk, "", "artist"]);
    }
  }

  // Featured artists as p-tags (role: "featured")
  if (params.featuredArtists) {
    for (const pk of params.featuredArtists) {
      tags.push(["p", pk, "", "featured"]);
    }
  }

  if (params.trackRefs) {
    for (const ref of params.trackRefs) {
      tags.push(["a", ref]);
    }
  }

  if (params.hashtags) {
    for (const t of params.hashtags) {
      tags.push(["t", t.toLowerCase()]);
    }
  }

  if (params.revisionSummary) {
    tags.push(["revision_summary", params.revisionSummary]);
  }
  if (params.sharingDisabled) {
    tags.push(["sharing", "disabled"]);
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

export function buildTrackNotesEvent(
  pubkey: string,
  params: {
    trackDTag: string;
    trackAddressableId: string;
    linerNotes?: string;
    productionNotes?: string;
    credits?: { role: string; name: string; pubkey?: string }[];
  },
): UnsignedEvent {
  const tags: string[][] = [
    ["d", `notes:${params.trackDTag}`],
    ["a", params.trackAddressableId],
  ];

  const content = JSON.stringify({
    linerNotes: params.linerNotes ?? "",
    productionNotes: params.productionNotes ?? "",
    credits: params.credits ?? [],
  });

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.MUSIC_TRACK_NOTES,
    tags,
    content,
  };
}

export function buildProposalEvent(
  pubkey: string,
  params: {
    proposalId: string;
    targetAlbum: string;
    ownerPubkey: string;
    title: string;
    description?: string;
    changes: ProposalChange[];
  },
): UnsignedEvent {
  const tags: string[][] = [
    ["d", params.proposalId],
    ["a", params.targetAlbum],
    ["p", params.ownerPubkey],
    ["status", "open"],
  ];

  const content = JSON.stringify({
    title: params.title,
    description: params.description,
    changes: params.changes,
  });

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.MUSIC_PROPOSAL,
    tags,
    content,
  };
}
