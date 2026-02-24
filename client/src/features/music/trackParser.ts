import type { NostrEvent } from "@/types/nostr";
import type { MusicTrack, MusicVisibility } from "@/types/music";
import type { ImetaVariant } from "@/types/media";
import { parseImetaTags } from "@/features/media/imetaParser";

/** Determine visibility from event tags */
function parseVisibility(event: NostrEvent): MusicVisibility {
  if (event.tags.some((t) => t[0] === "h")) return "space";
  if (event.tags.some((t) => t[0] === "visibility" && t[1] === "unlisted")) return "unlisted";
  return "public";
}

/** Parse a kind:31683 music track event into display data */
export function parseTrackEvent(event: NostrEvent): MusicTrack {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const title = event.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled";
  const artist =
    event.tags.find((t) => t[0] === "artist")?.[1] ??
    event.tags.find((t) => t[0] === "p")?.[1] ??
    event.pubkey;
  const durationStr = event.tags.find((t) => t[0] === "duration")?.[1];
  const genre = event.tags.find((t) => t[0] === "genre")?.[1];
  const imageUrl =
    event.tags.find((t) => t[0] === "image")?.[1] ??
    event.tags.find((t) => t[0] === "thumb")?.[1];
  const blurhash = event.tags.find((t) => t[0] === "blurhash")?.[1];
  const license = event.tags.find((t) => t[0] === "license")?.[1];
  const albumRef = event.tags.find(
    (t) => t[0] === "a" && t[1]?.startsWith("33123:"),
  )?.[1];

  const hashtags = event.tags
    .filter((t) => t[0] === "t")
    .map((t) => t[1]);

  // Extract featured artists from p-tags (excluding the event author)
  const featuredArtists = event.tags
    .filter((t) => t[0] === "p" && t[1] && t[1] !== event.pubkey)
    .map((t) => t[1]);

  let variants = parseImetaTags(event);

  // Fallback: if imeta parsing yielded no variants (e.g. missing mime type),
  // extract URL directly from imeta tag entries and create a synthetic variant
  if (variants.length === 0) {
    for (const tag of event.tags) {
      if (tag[0] !== "imeta") continue;
      for (let i = 1; i < tag.length; i++) {
        const entry = tag[i];
        if (entry.startsWith("url ")) {
          variants = [{
            url: entry.slice(4),
            mimeType: "audio/mpeg",
          }];
          break;
        }
      }
      if (variants.length > 0) break;
    }
  }

  const duration = durationStr
    ? parseFloat(durationStr)
    : variants[0]?.duration;

  return {
    addressableId: `31683:${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    artist,
    featuredArtists,
    albumRef,
    duration,
    genre,
    hashtags,
    variants,
    imageUrl,
    blurhash,
    createdAt: event.created_at,
    license,
    visibility: parseVisibility(event),
  };
}

/** Select the best audio URL from imeta variants */
export function selectAudioSource(variants: ImetaVariant[]): string | null {
  // Prefer higher quality audio formats
  const audio = variants
    .filter((v) => v.mimeType.startsWith("audio/"))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (audio.length > 0) return audio[0].url;

  // Fallback: any URL
  return variants[0]?.url ?? null;
}
