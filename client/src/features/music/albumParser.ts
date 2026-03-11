import type { NostrEvent } from "@/types/nostr";
import type { MusicAlbum, MusicVisibility, ProjectType } from "@/types/music";

/** Determine visibility from event tags */
function parseVisibility(event: NostrEvent): MusicVisibility {
  if (event.tags.some((t) => t[0] === "h")) return "space";
  if (event.tags.some((t) => t[0] === "visibility" && t[1] === "unlisted")) return "unlisted";
  return "public";
}

/** Parse a kind:33123 music album event into display data */
export function parseAlbumEvent(event: NostrEvent): MusicAlbum {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const title = event.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled Album";
  const artist =
    event.tags.find((t) => t[0] === "artist")?.[1] ?? event.pubkey;
  const imageUrl =
    event.tags.find((t) => t[0] === "image")?.[1] ??
    event.tags.find((t) => t[0] === "thumb")?.[1];
  const blurhash = event.tags.find((t) => t[0] === "blurhash")?.[1];
  const genre = event.tags.find((t) => t[0] === "genre")?.[1];
  const projectType = (event.tags.find((t) => t[0] === "project_type")?.[1] ?? "album") as ProjectType;

  // Ordered track refs from `a` tags pointing to kind:31683
  const trackRefs = event.tags
    .filter((t) => t[0] === "a" && t[1]?.startsWith("31683:"))
    .map((t) => t[1]);

  const durationStr = event.tags.find((t) => t[0] === "duration")?.[1];
  const totalDuration = durationStr ? parseFloat(durationStr) : undefined;

  const hashtags = event.tags
    .filter((t) => t[0] === "t")
    .map((t) => t[1]);

  // Detect whether any p-tag has a role field (index [3]).
  const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoledPTags = pTags.some((t) => t[3]);

  const artistPubkeys = hasRoledPTags
    ? pTags.filter((t) => t[3] === "artist").map((t) => t[1])
    : [];

  const featuredArtists = hasRoledPTags
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);

  const visibility = parseVisibility(event);
  const sharingDisabled = event.tags.some((t) => t[0] === "sharing" && t[1] === "disabled");
  const revisionSummary = event.tags.find((t) => t[0] === "revision_summary")?.[1];

  return {
    addressableId: `33123:${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    artist,
    artistPubkeys,
    featuredArtists,
    projectType,
    imageUrl,
    blurhash,
    genre,
    hashtags,
    trackRefs,
    trackCount: trackRefs.length,
    totalDuration,
    createdAt: event.created_at,
    visibility,
    sharingDisabled: sharingDisabled || undefined,
    revisionSummary,
  };
}
