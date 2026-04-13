import { useProfile } from "@/features/profile/useProfile";

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
