import type { MusicAlbum, MusicTrack } from "@/types/music";

export type ExploreItem =
  | { kind: "project"; id: string; album: MusicAlbum }
  | { kind: "track"; id: string; track: MusicTrack };

/**
 * Explore's "All" view: projects and loose tracks as one wall, newest first.
 *
 * A track whose project is already on the wall is left out, so a release
 * shows once (as its cover) rather than once per track. What remains are the
 * singles and the tracks whose project isn't in this page of results.
 */
export function mixExplore(albums: MusicAlbum[], tracks: MusicTrack[]): ExploreItem[] {
  const shownProjects = new Set(albums.map((a) => a.addressableId));
  const items: (ExploreItem & { at: number })[] = [];
  for (const album of albums) {
    items.push({ kind: "project", id: album.addressableId, album, at: album.createdAt });
  }
  for (const track of tracks) {
    if (track.albumRef && shownProjects.has(track.albumRef)) continue;
    items.push({ kind: "track", id: track.addressableId, track, at: track.createdAt });
  }
  // Stable sort: equal timestamps keep projects ahead of tracks.
  return items
    .sort((a, b) => b.at - a.at)
    .map(({ at: _at, ...item }) => item as ExploreItem);
}
