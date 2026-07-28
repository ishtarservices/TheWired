import type {
  MusicTrack,
  MusicAlbum,
  TrackSortKey,
  AlbumSortKey,
  SortDir,
} from "@/types/music";

export type { TrackSortKey, AlbumSortKey, SortDir };

export interface SortOption<K> {
  key: K;
  label: string;
}

export const TRACK_SORT_OPTIONS: SortOption<TrackSortKey>[] = [
  { key: "added", label: "Recently added" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "genre", label: "Genre" },
  { key: "duration", label: "Duration" },
  { key: "released", label: "Date released" },
];

export const ALBUM_SORT_OPTIONS: SortOption<AlbumSortKey>[] = [
  { key: "added", label: "Recently added" },
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "genre", label: "Genre" },
  { key: "tracks", label: "Track count" },
  { key: "released", label: "Date released" },
];

/** The sensible direction the first time a given key is selected. */
export function defaultDir(key: TrackSortKey | AlbumSortKey): SortDir {
  switch (key) {
    case "added":
    case "released":
    case "tracks":
      return "desc"; // newest / most first
    default:
      return "asc"; // A→Z, shortest→longest
  }
}

export function flipDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function textCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Compare two optional values, always sorting `undefined`/empty to the END
 * regardless of direction. Returns a value oriented for ascending order; the
 * caller applies the direction sign only to "present vs present" comparisons.
 */
function presence(a: unknown, b: unknown): number | null {
  const aMissing = a === undefined || a === null || a === "";
  const bMissing = b === undefined || b === null || b === "";
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // a goes last
  if (bMissing) return -1; // b goes last
  return null; // both present — let the real comparator decide
}

function applyDir(cmp: number, dir: SortDir): number {
  return dir === "asc" ? cmp : -cmp;
}

export function sortTracks(
  tracks: MusicTrack[],
  key: TrackSortKey,
  dir: SortDir,
): MusicTrack[] {
  if (key === "added") {
    // Incoming order is the selector's natural "recently added" order (newest first).
    return dir === "desc" ? tracks.slice() : tracks.slice().reverse();
  }
  return tracks.slice().sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "title":
        cmp = textCompare(a.title, b.title);
        break;
      case "artist":
        cmp = textCompare(a.artist, b.artist);
        break;
      case "genre": {
        const p = presence(a.genre, b.genre);
        if (p !== null) return p; // missing genre to the end, direction-independent
        cmp = textCompare(a.genre!, b.genre!);
        break;
      }
      case "duration": {
        const p = presence(a.duration, b.duration);
        if (p !== null) return p;
        cmp = a.duration! - b.duration!;
        break;
      }
      case "released":
        cmp = a.createdAt - b.createdAt;
        break;
    }
    if (cmp === 0) cmp = b.createdAt - a.createdAt; // stable tiebreak: newest first
    return applyDir(cmp, dir);
  });
}

export function sortAlbums(
  albums: MusicAlbum[],
  key: AlbumSortKey,
  dir: SortDir,
): MusicAlbum[] {
  if (key === "added") {
    return dir === "desc" ? albums.slice() : albums.slice().reverse();
  }
  return albums.slice().sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "title":
        cmp = textCompare(a.title, b.title);
        break;
      case "artist":
        cmp = textCompare(a.artist, b.artist);
        break;
      case "genre": {
        const p = presence(a.genre, b.genre);
        if (p !== null) return p;
        cmp = textCompare(a.genre!, b.genre!);
        break;
      }
      case "tracks":
        cmp = a.trackCount - b.trackCount;
        break;
      case "released":
        cmp = a.createdAt - b.createdAt;
        break;
    }
    if (cmp === 0) cmp = b.createdAt - a.createdAt;
    return applyDir(cmp, dir);
  });
}

/** Case-insensitive contains-match on title or artist. Empty query returns input unchanged. */
export function filterTracks(tracks: MusicTrack[], query: string): MusicTrack[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );
}

export function filterAlbums(albums: MusicAlbum[], query: string): MusicAlbum[] {
  const q = query.trim().toLowerCase();
  if (!q) return albums;
  return albums.filter(
    (a) => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q),
  );
}
