import type { NostrEvent } from "@/types/nostr";
import type { MusicPlaylist, MusicVisibility } from "@/types/music";

/** Determine visibility from event tags */
function parseVisibility(event: NostrEvent): MusicVisibility {
  if (event.tags.some((t) => t[0] === "h")) return "space";
  if (event.tags.some((t) => t[0] === "visibility" && t[1] === "unlisted")) return "unlisted";
  return "public";
}

/** Parse a kind:30119 music playlist event into display data */
export function parsePlaylistEvent(event: NostrEvent): MusicPlaylist {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const title = event.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled Playlist";
  const description = event.tags.find((t) => t[0] === "summary")?.[1] ?? (event.content || undefined);
  const imageUrl = event.tags.find((t) => t[0] === "image")?.[1];

  // Ordered track refs from `a` tags pointing to kind:31683
  const trackRefs = event.tags
    .filter((t) => t[0] === "a" && t[1]?.startsWith("31683:"))
    .map((t) => t[1]);

  return {
    addressableId: `30119:${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    description,
    imageUrl,
    trackRefs,
    createdAt: event.created_at,
    visibility: parseVisibility(event),
  };
}
