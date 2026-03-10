import { parseBlob } from "music-metadata";

/** Embedded cover art extracted from audio file metadata */
export interface EmbeddedCoverArt {
  /** Object URL for preview display (must be revoked when done) */
  objectUrl: string;
  /** The image as a File, ready for upload */
  file: File;
  /** MIME type (e.g. "image/jpeg") */
  format: string;
}

/** Parsed metadata from a track file (filename + ID3 tags combined) */
export interface ParsedTrackInfo {
  file: File;
  /** Resolved title (ID3 > filename-parsed > raw filename) */
  title: string;
  /** Track number if detected (1-based) */
  trackNumber: number | null;
  /** Disc number if detected */
  discNumber: number | null;
  /** Artist from ID3 tags */
  artist: string;
  /** Album name from ID3 tags */
  album: string;
  /** Genre from ID3 tags */
  genre: string;
  /** Year from ID3 tags */
  year: string;
  /** Duration in seconds from ID3 */
  duration: number | null;
  /** Embedded cover art from ID3 tags */
  embeddedCover: EmbeddedCoverArt | null;
  /** Whether ID3 metadata was found */
  hasId3: boolean;
  /** Upload progress (0-100) */
  uploadProgress: number;
  /** Upload status */
  status: "pending" | "uploading" | "done" | "error";
  /** Error message if failed */
  errorMsg?: string;
  /** Unique key for React */
  key: string;
}

// Common filename patterns for track numbering:
// "01 - Track Name.mp3"
// "01. Track Name.mp3"
// "01_Track_Name.mp3"
// "1-01 Track Name.mp3"  (disc-track)
// "01 Track Name.mp3"
// "Track Name.mp3" (no number)
// "Artist - 01 - Track Name.mp3"
// "Artist - Track Name.mp3"

const TRACK_PATTERNS: RegExp[] = [
  // Disc-Track: "1-01 ..." or "1.01 ..."
  /^(\d{1,2})[-.](\d{1,3})\s*[-._\s]\s*(.+)$/,
  // Track number with separator: "01 - Name" / "01. Name" / "01_Name"
  /^(\d{1,3})\s*[-._)\]]\s*(.+)$/,
  // Track number with just space: "01 Name"
  /^(\d{1,3})\s+([A-Za-z].+)$/,
];

const ARTIST_TITLE_SEP = /\s+-\s+/;

interface FilenameParsed {
  title: string;
  trackNumber: number | null;
  discNumber: number | null;
  artist: string;
}

/** Strip file extension */
function stripExt(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/** Clean up underscores, extra whitespace */
function cleanTitle(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse track info from filename alone */
export function parseFilename(filename: string): FilenameParsed {
  const base = stripExt(filename);
  let title = cleanTitle(base);
  let trackNumber: number | null = null;
  let discNumber: number | null = null;
  let artist = "";

  // Try disc-track pattern first
  const discMatch = base.match(TRACK_PATTERNS[0]);
  if (discMatch) {
    discNumber = parseInt(discMatch[1], 10);
    trackNumber = parseInt(discMatch[2], 10);
    title = cleanTitle(discMatch[3]);
  } else {
    // Try other track number patterns
    for (let i = 1; i < TRACK_PATTERNS.length; i++) {
      const m = base.match(TRACK_PATTERNS[i]);
      if (m) {
        const num = parseInt(m[1], 10);
        // Sanity: track numbers above 200 are probably not track numbers (could be year, etc.)
        if (num > 0 && num <= 200) {
          trackNumber = num;
          title = cleanTitle(m[2]);
        }
        break;
      }
    }
  }

  // Check for "Artist - Title" pattern in the remaining title
  const sepMatch = title.match(ARTIST_TITLE_SEP);
  if (sepMatch && sepMatch.index !== undefined) {
    const parts = title.split(ARTIST_TITLE_SEP);
    if (parts.length === 2) {
      artist = parts[0].trim();
      title = parts[1].trim();
    } else if (parts.length > 2) {
      // "Artist - Album - Title" or similar — take first as artist, last as title
      artist = parts[0].trim();
      title = parts[parts.length - 1].trim();
    }
  }

  return { title, trackNumber, discNumber, artist };
}

/** Extract embedded cover art from music-metadata picture data */
function extractCoverArt(
  pictures: Array<{ format: string; data: Uint8Array; type?: string }> | undefined,
  sourceFilename: string,
): EmbeddedCoverArt | null {
  if (!pictures || pictures.length === 0) return null;

  // Prefer "Cover (front)" type, fall back to first picture
  const front = pictures.find((p) => p.type === "Cover (front)") ?? pictures[0];
  if (!front?.data || front.data.length === 0) return null;

  const format = front.format || "image/jpeg";
  const ext = format.includes("png") ? ".png" : format.includes("gif") ? ".gif" : ".jpg";
  const blob = new Blob([new Uint8Array(front.data)], { type: format });
  const file = new File([blob], `cover-${sourceFilename}${ext}`, { type: format });
  const objectUrl = URL.createObjectURL(blob);

  return { objectUrl, file, format };
}

/** Read ID3/metadata tags from an audio File using music-metadata */
export async function readAudioMetadata(file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;
  coverArt?: EmbeddedCoverArt | null;
}> {
  try {
    const metadata = await parseBlob(file, { duration: true });
    const common = metadata.common;
    return {
      title: common.title || undefined,
      artist: common.artist || undefined,
      album: common.album || undefined,
      genre: common.genre?.[0] || undefined,
      year: common.year ? String(common.year) : undefined,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      duration: metadata.format.duration,
      coverArt: extractCoverArt(
        common.picture as Array<{ format: string; data: Uint8Array; type?: string }> | undefined,
        file.name.replace(/\.[^.]+$/, ""),
      ),
    };
  } catch {
    // If metadata parsing fails (corrupt file, unsupported format), return empty
    return {};
  }
}

let keyCounter = 0;

/** Parse a batch of files: extract filename info + ID3 metadata */
export async function parseTrackFiles(files: File[]): Promise<ParsedTrackInfo[]> {
  const results = await Promise.all(
    files.map(async (file): Promise<ParsedTrackInfo> => {
      const fromFilename = parseFilename(file.name);
      const id3 = await readAudioMetadata(file);
      const hasId3 = !!(id3.title || id3.artist || id3.trackNumber);

      return {
        file,
        // ID3 title > filename-parsed title
        title: id3.title || fromFilename.title,
        // ID3 track > filename track
        trackNumber: id3.trackNumber ?? fromFilename.trackNumber,
        discNumber: id3.discNumber ?? fromFilename.discNumber,
        artist: id3.artist || fromFilename.artist,
        album: id3.album || "",
        genre: id3.genre || "",
        year: id3.year || "",
        duration: id3.duration ?? null,
        embeddedCover: id3.coverArt ?? null,
        hasId3,
        uploadProgress: 0,
        status: "pending",
        key: `track-${++keyCounter}-${file.name}`,
      };
    }),
  );

  return results;
}

/** Sort tracks by disc number then track number, preserving original order for unnumbered tracks */
export function sortTracksByNumber(tracks: ParsedTrackInfo[]): ParsedTrackInfo[] {
  return [...tracks].sort((a, b) => {
    // Tracks with numbers come before those without
    const aHasNum = a.trackNumber !== null;
    const bHasNum = b.trackNumber !== null;
    if (aHasNum && !bHasNum) return -1;
    if (!aHasNum && bHasNum) return 1;
    if (!aHasNum && !bHasNum) return 0;

    // Sort by disc first
    const discA = a.discNumber ?? 1;
    const discB = b.discNumber ?? 1;
    if (discA !== discB) return discA - discB;

    // Then by track number
    return (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
  });
}

/** Try to detect common album info from a batch of parsed tracks */
export function detectAlbumInfo(tracks: ParsedTrackInfo[]): {
  albumTitle: string;
  artist: string;
  genre: string;
  year: string;
} {
  // Find most common album name from ID3
  const albumCounts = new Map<string, number>();
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const yearCounts = new Map<string, number>();

  for (const t of tracks) {
    if (t.album) albumCounts.set(t.album, (albumCounts.get(t.album) ?? 0) + 1);
    if (t.artist) artistCounts.set(t.artist, (artistCounts.get(t.artist) ?? 0) + 1);
    if (t.genre) genreCounts.set(t.genre, (genreCounts.get(t.genre) ?? 0) + 1);
    if (t.year) yearCounts.set(t.year, (yearCounts.get(t.year) ?? 0) + 1);
  }

  const mostCommon = (map: Map<string, number>) => {
    let best = "";
    let max = 0;
    for (const [k, v] of map) {
      if (v > max) { best = k; max = v; }
    }
    return best;
  };

  return {
    albumTitle: mostCommon(albumCounts),
    artist: mostCommon(artistCounts),
    genre: mostCommon(genreCounts),
    year: mostCommon(yearCounts),
  };
}

/** Format duration as mm:ss */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Re-number tracks sequentially starting from 1 based on current order */
export function renumberTracks(tracks: ParsedTrackInfo[]): ParsedTrackInfo[] {
  return tracks.map((t, i) => ({ ...t, trackNumber: i + 1 }));
}

/**
 * Find the best embedded cover art from a batch of tracks.
 * Prefers the cover from track #1, then the largest image found.
 */
export function findBestCover(tracks: ParsedTrackInfo[]): EmbeddedCoverArt | null {
  const withCovers = tracks.filter((t) => t.embeddedCover !== null);
  if (withCovers.length === 0) return null;

  // Prefer the cover from the first track (by track number)
  const track1 = withCovers.find((t) => t.trackNumber === 1);
  if (track1?.embeddedCover) return track1.embeddedCover;

  // Fall back to the largest cover image (likely highest quality)
  let best: EmbeddedCoverArt | null = null;
  let bestSize = 0;
  for (const t of withCovers) {
    const size = t.embeddedCover!.file.size;
    if (size > bestSize) {
      bestSize = size;
      best = t.embeddedCover;
    }
  }
  return best;
}

/** Revoke all object URLs from embedded covers to prevent memory leaks */
export function cleanupTrackCovers(tracks: ParsedTrackInfo[]): void {
  for (const t of tracks) {
    if (t.embeddedCover) {
      URL.revokeObjectURL(t.embeddedCover.objectUrl);
    }
  }
}
