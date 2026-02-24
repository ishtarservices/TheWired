import type { MusicTrack, MusicAlbum } from "@/types/music";

/** Returns track's own image, falling back to parent album image */
export function getTrackImage(
  track: MusicTrack,
  albums: Record<string, MusicAlbum>,
): string | undefined {
  if (track.imageUrl) return track.imageUrl;
  if (track.albumRef) return albums[track.albumRef]?.imageUrl;
  return undefined;
}
