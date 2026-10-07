import type { MusicAlbum, MusicMember, MusicTrack } from "@/types/music";
import { selectAudioSource } from "../trackParser";
import { isSharedRelease } from "./members";
import { signerForRelease, type ReleaseSigner } from "./ownership";

export const NO_PROJECT_KEY_MESSAGE = "This project's key isn't on this device.";

/**
 * Who an edit of a release publishes as: the release's own author when this
 * device can sign as it (my account, or a held shared-project key), otherwise
 * my account (a copy at my address, as before shared keys).
 *
 * A shared release is never copied: a copy would carry its `owner` tags under
 * my key and look like a different shared project. Without the key the member
 * proposes instead, so this throws.
 */
export async function editAuthorFor(
  item: { pubkey: string; owners?: readonly string[] },
  me: string,
): Promise<ReleaseSigner> {
  const own = await signerForRelease(item.pubkey);
  if (own) return own;
  if (isSharedRelease(item)) throw new Error(NO_PROJECT_KEY_MESSAGE);
  return { pubkey: me };
}

/**
 * Members for a rebuilt shared private release: the private-collaborator
 * picker maps onto `collaborator` member tags (the relay-gated private form,
 * no NIP-44 copies). Other roles are kept as they were.
 */
export function membersWithCollaborators(
  members: readonly MusicMember[] | undefined,
  collaborators: readonly string[],
): MusicMember[] {
  const rest = (members ?? []).filter((m) => m.role !== "collaborator");
  const seen = new Set(rest.map((m) => m.pubkey + ":" + m.role));
  const added = collaborators
    .filter((pubkey) => !seen.has(pubkey + ":collaborator"))
    .map((pubkey) => ({ pubkey, role: "collaborator" as const }));
  return [...rest, ...added];
}

/** buildAlbumEvent params that republish `album` unchanged (members included);
 *  spread overrides on top. */
export function albumParamsFrom(album: MusicAlbum) {
  return {
    title: album.title,
    artist: album.artist,
    slug: album.addressableId.split(":").slice(2).join(":"),
    genre: album.genre || undefined,
    imageUrl: album.imageUrl,
    trackRefs: album.trackRefs.length > 0 ? album.trackRefs : undefined,
    featuredArtists: album.featuredArtists.length > 0 ? album.featuredArtists : undefined,
    artistPubkeys: album.artistPubkeys.length > 0 ? album.artistPubkeys : undefined,
    hashtags: album.hashtags.length > 0 ? album.hashtags : undefined,
    projectType: album.projectType,
    visibility: album.visibility,
    spaceId: album.visibility === "space" ? album.spaceId : undefined,
    spaceIds: album.visibility === "space" ? album.spaceIds : undefined,
    channelId: album.visibility === "space" ? album.channelId : undefined,
    sharingDisabled: album.sharingDisabled,
    members: album.members,
  };
}

/** buildTrackEvent params that republish `track` unchanged (audio imeta,
 *  scope, catalog flag and members included), or null when its audio URL
 *  can't be resolved. Spread overrides on top. */
export function trackParamsFrom(track: MusicTrack) {
  const audioUrl = selectAudioSource(track.variants);
  if (!audioUrl) return null;
  const variant = track.variants.find((v) => v.url === audioUrl) ?? track.variants[0];
  return {
    title: track.title,
    artist: track.artist,
    slug: track.addressableId.split(":").slice(2).join(":"),
    duration: track.duration,
    genre: track.genre || undefined,
    audioUrl,
    audioHash: variant?.hash,
    audioSize: variant?.size,
    audioMime: variant?.mimeType,
    imageUrl: track.imageUrl,
    hashtags: track.hashtags.length > 0 ? track.hashtags : undefined,
    albumRef: track.albumRef,
    license: track.license,
    artistPubkeys: track.artistPubkeys.length > 0 ? track.artistPubkeys : undefined,
    featuredArtists: track.featuredArtists.length > 0 ? track.featuredArtists : undefined,
    visibility: track.visibility,
    spaceId: track.visibility === "space" ? track.spaceId : undefined,
    spaceIds: track.visibility === "space" ? track.spaceIds : undefined,
    channelId: track.visibility === "space" ? track.channelId : undefined,
    sharingDisabled: track.sharingDisabled,
    inCatalog: track.inCatalog,
    members: track.members,
  };
}
