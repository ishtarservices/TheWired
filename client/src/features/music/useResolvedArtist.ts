import { useProfile } from "@/features/profile/useProfile";
import type { MusicView } from "@/types/music";

/** Check if a string is a 64-char hex pubkey */
function isHexPubkey(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s);
}

/**
 * Resolves an artist string to a human-readable name.
 * If the artist field contains a raw hex pubkey (common when users leave the
 * artist field empty and the code falls back to `event.pubkey`), this hook
 * looks up the corresponding Nostr profile and returns the display name.
 */
export function useResolvedArtist(
  artist: string,
  artistPubkeys?: string[],
): string {
  const needsResolving = isHexPubkey(artist);
  const pubkeyToResolve = needsResolving
    ? artist
    : (artistPubkeys?.length ? artistPubkeys[0] : null);

  const { profile } = useProfile(pubkeyToResolve);

  if (!needsResolving) return artist;

  if (profile?.display_name) return profile.display_name;
  if (profile?.name) return profile.name;

  return artist.slice(0, 8) + "\u2026";
}

/**
 * Builds the setActiveDetailId payload for navigating to an artist's detail
 * page. Prefers pubkey routing when an explicit artist pubkey is available;
 * otherwise falls back to name-based routing ("name:<normalized>") matching
 * the ArtistDetail view's expectations. Returns null when there is no usable
 * identifier (e.g., empty artist string with no pubkeys).
 */
export function resolveArtistDetailTarget(
  artist: string,
  artistPubkeys?: string[],
): { view: MusicView; id: string } | null {
  if (artistPubkeys && artistPubkeys.length > 0) {
    return { view: "artist-detail", id: artistPubkeys[0] };
  }
  if (isHexPubkey(artist)) {
    return { view: "artist-detail", id: artist };
  }
  const normalized = artist.toLowerCase().trim();
  if (!normalized) return null;
  return { view: "artist-detail", id: `name:${normalized}` };
}
