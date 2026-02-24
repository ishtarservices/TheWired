import type { NostrEvent } from "../../types/nostr";
import type { ImetaVariant, VideoEvent } from "../../types/media";

/** Parse imeta tags from a video event */
export function parseImetaTags(event: NostrEvent): ImetaVariant[] {
  const variants: ImetaVariant[] = [];

  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;

    const variant: Partial<ImetaVariant> = {};

    // Parse space-delimited key-value pairs within the imeta tag entries
    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      const spaceIdx = entry.indexOf(" ");
      if (spaceIdx === -1) continue;

      const key = entry.slice(0, spaceIdx);
      const value = entry.slice(spaceIdx + 1);

      switch (key) {
        case "url":
          variant.url = value;
          break;
        case "m":
          variant.mimeType = value;
          break;
        case "x":
          variant.hash = value;
          break;
        case "size":
          variant.size = parseInt(value, 10);
          break;
        case "dim":
          variant.dim = value;
          break;
        case "bitrate":
          variant.bitrate = parseInt(value, 10);
          break;
        case "duration":
          variant.duration = parseFloat(value);
          break;
        case "fallback":
          variant.fallback = value;
          break;
        case "blurhash":
          variant.blurhash = value;
          break;
      }
    }

    if (variant.url && variant.mimeType) {
      variants.push(variant as ImetaVariant);
    }
  }

  return variants;
}

/** Convert a video event to display data */
export function parseVideoEvent(event: NostrEvent): VideoEvent {
  const variants = parseImetaTags(event);
  const title = event.tags.find((t) => t[0] === "title")?.[1];
  const summary = event.tags.find((t) => t[0] === "summary")?.[1];
  const thumbnail =
    event.tags.find((t) => t[0] === "thumb")?.[1] ??
    event.tags.find((t) => t[0] === "image")?.[1];
  const durationStr = event.tags.find((t) => t[0] === "duration")?.[1];
  const duration = durationStr ? parseFloat(durationStr) : variants[0]?.duration;

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    summary,
    thumbnail,
    duration,
    variants,
    createdAt: event.created_at,
  };
}

/** Select the best video URL: prefer HLS, fallback to MP4 */
export function selectVideoSource(variants: ImetaVariant[]): string | null {
  // Prefer HLS
  const hls = variants.find(
    (v) => v.mimeType === "application/x-mpegURL" || v.mimeType === "application/vnd.apple.mpegurl",
  );
  if (hls) return hls.url;

  // Fallback to highest bitrate MP4
  const mp4s = variants
    .filter((v) => v.mimeType.startsWith("video/"))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  if (mp4s.length > 0) return mp4s[0].url;

  // Any URL
  return variants[0]?.url ?? null;
}
