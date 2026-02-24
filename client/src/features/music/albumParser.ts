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

  // Extract featured artists from p-tags (excluding the event author)
  const featuredArtists = event.tags
    .filter((t) => t[0] === "p" && t[1] && t[1] !== event.pubkey)
    .map((t) => t[1]);

  return {
    addressableId: `33123:${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    artist,
    featuredArtists,
    projectType,
    imageUrl,
    blurhash,
    genre,
    trackRefs,
    trackCount: trackRefs.length,
    totalDuration,
    createdAt: event.created_at,
    visibility: parseVisibility(event),
  };
}
