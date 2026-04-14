import type { NostrEvent } from "@/types/nostr";
import type { MusicTrack, MusicVisibility } from "@/types/music";
import type { ImetaVariant } from "@/types/media";
import { parseImetaTags } from "@/features/media/imetaParser";

/** Determine visibility from event tags */
function parseVisibility(event: NostrEvent): MusicVisibility {
  if (event.tags.some((t) => t[0] === "h")) return "space";
  const vis = event.tags.find((t) => t[0] === "visibility")?.[1];
  if (vis === "private" || vis === "unlisted") return "private"; // backward compat
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

  // Detect whether any p-tag has a role field (index [3]).
  // If none do, this is a legacy event — treat all non-author p-tags as featured.
  const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoledPTags = pTags.some((t) => t[3]);

  // Extract artist pubkeys from p-tags with role "artist"
  const artistPubkeys = hasRoledPTags
    ? pTags.filter((t) => t[3] === "artist").map((t) => t[1])
    : [];

  // Extract featured artists from p-tags
  const featuredArtists = hasRoledPTags
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);

  // Extract collaborators from p-tags with role "collaborator"
  const collaborators = hasRoledPTags
    ? pTags.filter((t) => t[3] === "collaborator").map((t) => t[1])
    : [];

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

  const visibility = parseVisibility(event);
  const sharingDisabled = event.tags.some((t) => t[0] === "sharing" && t[1] === "disabled");
  const revisionSummary = event.tags.find((t) => t[0] === "revision_summary")?.[1];

  return {
    addressableId: `31683:${event.pubkey}:${dTag}`,
    eventId: event.id,
    pubkey: event.pubkey,
    title,
    artist,
    artistPubkeys,
    featuredArtists,
    collaborators,
    albumRef,
    duration,
    genre,
    hashtags,
    variants,
    imageUrl,
    blurhash,
    createdAt: event.created_at,
    license,
    visibility,
    sharingDisabled: sharingDisabled || undefined,
    revisionSummary,
  };
}

/**
 * Attempt to parse a private (NIP-44 encrypted) track event.
 * Returns the decrypted MusicTrack if the viewer is the owner or a tagged collaborator.
 * Returns null if decryption fails (not authorized).
 */
export async function parsePrivateTrackEvent(
  event: NostrEvent,
  viewerPubkey: string,
): Promise<MusicTrack | null> {
  const visibility = parseVisibility(event);
  if (visibility !== "private") return parseTrackEvent(event);

  // If content is empty, this is a private event without encrypted metadata
  // (e.g. old-style unlisted). Fall back to cleartext parsing.
  if (!event.content) return parseTrackEvent(event);

  try {
    const { nip44Decrypt } = await import("@/lib/nostr/nip44");
    let plaintext: string;

    if (event.pubkey === viewerPubkey) {
      // Owner: content is encrypted to self
      plaintext = await nip44Decrypt(viewerPubkey, event.content);
    } else {
      // Collaborator: find per-collaborator encrypted_content tag
      const myTag = event.tags.find(
        (t) => t[0] === "encrypted_content" && t[2] === viewerPubkey,
      );
      if (!myTag) return null; // Not a collaborator
      plaintext = await nip44Decrypt(event.pubkey, myTag[1]);
    }

    const meta = JSON.parse(plaintext) as Record<string, unknown>;
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";

    // Extract artist/featured pubkeys from cleartext p-tags
    const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
    const hasRoledPTags = pTags.some((t) => t[3]);
    const artistPubkeys = hasRoledPTags
      ? pTags.filter((t) => t[3] === "artist").map((t) => t[1])
      : [];
    const featuredArtists = hasRoledPTags
      ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
      : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);
    const collaborators = hasRoledPTags
      ? pTags.filter((t) => t[3] === "collaborator").map((t) => t[1])
      : [];

    return {
      addressableId: `31683:${event.pubkey}:${dTag}`,
      eventId: event.id,
      pubkey: event.pubkey,
      title: (meta.title as string) ?? "Untitled",
      artist: (meta.artist as string) ?? event.pubkey,
      artistPubkeys,
      featuredArtists,
      collaborators,
      albumRef: meta.albumRef as string | undefined,
      duration: meta.duration as number | undefined,
      genre: meta.genre as string | undefined,
      hashtags: (meta.hashtags as string[]) ?? [],
      variants: meta.audioUrl
        ? [{ url: meta.audioUrl as string, mimeType: (meta.audioMime as string) ?? "audio/mpeg" }]
        : [],
      imageUrl: meta.imageUrl as string | undefined,
      createdAt: event.created_at,
      license: meta.license as string | undefined,
      visibility: "private",
      revisionSummary: meta.revisionSummary as string | undefined,
    };
  } catch {
    return null; // Decryption failed — not authorized
  }
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
