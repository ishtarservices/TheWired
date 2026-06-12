import { isHexPubkey } from "./useResolvedArtist";

export type ZapRole = "primary" | "featured" | "uploader";

export interface ZapArtist {
  pubkey: string;
  role: ZapRole;
}

/** The subset of a track/album needed to derive its zappable artists. */
export interface ZappableMusicItem {
  artist: string;
  artistPubkeys: string[];
  featuredArtists: string[];
}

/**
 * Ordered, de-duplicated list of artist pubkeys that can receive a zap for a
 * track or album. The primary artist comes first — the explicit role:"artist"
 * p-tag (`artistPubkeys[0]`), else the `artist` field when it is itself a hex
 * pubkey — followed by each featured artist.
 *
 * Returns `[]` for a name-only item with no linked pubkeys; callers then fall
 * back to tipping the uploader (`item.pubkey`).
 */
export function getZappableArtists(item: ZappableMusicItem): ZapArtist[] {
  const primary =
    item.artistPubkeys[0] ?? (isHexPubkey(item.artist) ? item.artist : null);

  const out: ZapArtist[] = [];
  const seen = new Set<string>();

  if (primary) {
    out.push({ pubkey: primary, role: "primary" });
    seen.add(primary);
  }
  for (const pk of item.featuredArtists) {
    if (!seen.has(pk)) {
      out.push({ pubkey: pk, role: "featured" });
      seen.add(pk);
    }
  }
  return out;
}

/**
 * Full ordered zap-target list for a track/album: the credited artists, plus the
 * uploader (event publisher) as an extra "uploader" target whenever they aren't
 * already credited. There is always at least one target, since every event has a
 * publisher — so a name-only item resolves to a single "uploader" target.
 */
export function getZapTargets(
  item: ZappableMusicItem & { pubkey: string },
): ZapArtist[] {
  const artists = getZappableArtists(item);
  if (artists.some((a) => a.pubkey === item.pubkey)) return artists;
  return [...artists, { pubkey: item.pubkey, role: "uploader" }];
}
