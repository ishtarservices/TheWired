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

/**
 * Music home's collection wall: the viewer's projects and loose tracks, each
 * release once.
 *
 * Saving a few tracks of a project (without the project itself) would put the
 * same cover on the wall once per track. When two or more library tracks share
 * a project the store knows, they fold into that project's card instead.
 */
export function collectionWall(
  libraryAlbums: MusicAlbum[],
  libraryTracks: MusicTrack[],
  albumsById: Record<string, MusicAlbum | undefined>,
): ExploreItem[] {
  const have = new Set(libraryAlbums.map((a) => a.addressableId));
  const perProject = new Map<string, number>();
  for (const t of libraryTracks) {
    if (t.albumRef && !have.has(t.albumRef)) {
      perProject.set(t.albumRef, (perProject.get(t.albumRef) ?? 0) + 1);
    }
  }
  const folded: MusicAlbum[] = [];
  for (const [ref, n] of perProject) {
    const album = albumsById[ref];
    if (n >= 2 && album) folded.push(album);
  }
  return mixExplore([...libraryAlbums, ...folded], libraryTracks);
}

/** What `byInteraction` needs to know about the viewer. */
export interface InteractionContext {
  /** Unix seconds each track id was last played. */
  playedAt: Record<string, number>;
  /** The synced library's stamps: id → unix seconds saved (negative = removed). */
  savedStamps: Record<string, number>;
  /** Authored by the viewer, or by a shared-project key this device holds. */
  isMine: (pubkey: string) => boolean;
  /** Track ids that belong to a project (its refs, or the tracks naming it). */
  tracksOf: (album: MusicAlbum) => string[];
}

/** When the viewer last touched a release: played it, saved it, or (for their
 *  own) published or edited it. 0 when nothing is known. */
export function lastInteraction(item: ExploreItem, ctx: InteractionContext): number {
  const saved = (id: string) => Math.max(0, ctx.savedStamps[id] ?? 0);
  if (item.kind === "track") {
    const t = item.track;
    return Math.max(ctx.playedAt[t.addressableId] ?? 0, saved(t.addressableId), ctx.isMine(t.pubkey) ? t.createdAt : 0);
  }
  const a = item.album;
  let played = 0;
  for (const id of ctx.tracksOf(a)) played = Math.max(played, ctx.playedAt[id] ?? 0);
  return Math.max(played, saved(a.addressableId), ctx.isMine(a.pubkey) ? a.createdAt : 0);
}

/** Order a wall by most recent interaction. Releases with nothing recorded
 *  keep their incoming order, after everything that has a time. */
export function byInteraction(items: ExploreItem[], ctx: InteractionContext): ExploreItem[] {
  return items
    .map((item, i) => ({ item, i, at: lastInteraction(item, ctx) }))
    .sort((x, y) => y.at - x.at || x.i - y.i)
    .map((x) => x.item);
}
