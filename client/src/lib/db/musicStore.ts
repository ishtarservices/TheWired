import type { MusicFolderDocs, MusicLibraryRecord } from "@ishtarservices/core";
import { saveUserState, getUserState, getUserStateWithTime } from "./userStateStore";
import type { RootState } from "@/store";

const LIBRARY_KEY = "music_library";
const FOLDERS_KEY = "music_folders";
const LOCAL_IDS_KEY = "music_local_ids";

export interface MusicLibraryState {
  savedTrackIds: string[];
  savedAlbumIds: string[];
  favoritedTrackIds: string[];
  favoritedAlbumIds: string[];
  followedArtists: string[];
  /** Written by builds before folders; ignored now. */
  userPlaylists?: string[];
  recentlyPlayedIds: string[];
  /** Unix seconds each recently played id was last played. Absent in rows
   *  written by older builds. */
  recentlyPlayedAt?: Record<string, number>;
  /** Cross-device sync record (docs/MUSIC_LIBRARY_SYNC.md). Written in the
   *  same row as the arrays so the two can never drift apart. Absent in rows
   *  written by older builds — hydrate then seeds it from the arrays. */
  sync?: { v: 1; record: MusicLibraryRecord };
  /** ms since epoch of this write. */
  updatedAt?: number;
}

export interface MusicFoldersRow {
  v: 1;
  docs: MusicFolderDocs;
}

/** Load music library state from IndexedDB */
export async function loadMusicLibrary(): Promise<MusicLibraryState | undefined> {
  return getUserState<MusicLibraryState>(LIBRARY_KEY);
}

/** The library row plus when it was last written (ms; 0 = unknown) — rows
 *  from builds before sync carry no `updatedAt` of their own. */
export async function loadMusicLibraryWithTime(): Promise<{ row: MusicLibraryState; writtenAt: number } | undefined> {
  const got = await getUserStateWithTime<MusicLibraryState>(LIBRARY_KEY);
  if (!got) return undefined;
  return { row: got.data, writtenAt: got.data.updatedAt ?? got.cachedAt };
}

/** Save music library state to IndexedDB */
export async function saveMusicLibrary(library: MusicLibraryState): Promise<void> {
  await saveUserState(LIBRARY_KEY, library);
}

/** Write the library row from the store: arrays + sync record together.
 *  Skipped until the row was read (and never over a failed read). */
export async function persistMusicLibraryFrom(state: RootState): Promise<void> {
  const music = state.music;
  if (!music.librarySync.hydrated || music.librarySync.readFailed) return;
  const { savedTrackIds, savedAlbumIds, favoritedTrackIds, favoritedAlbumIds, followedArtists } = music.library;
  await saveMusicLibrary({
    savedTrackIds,
    savedAlbumIds,
    favoritedTrackIds,
    favoritedAlbumIds,
    followedArtists,
    recentlyPlayedIds: music.discovery.recentlyPlayedIds,
    recentlyPlayedAt: music.discovery.recentlyPlayedAt,
    sync: { v: 1, record: music.librarySync.record },
    updatedAt: Date.now(),
  });
}

export async function loadMusicFolders(): Promise<MusicFoldersRow | undefined> {
  return getUserState<MusicFoldersRow>(FOLDERS_KEY);
}

export async function persistMusicFoldersFrom(state: RootState): Promise<void> {
  const sync = state.music.librarySync;
  if (!sync.hydrated || sync.readFailed) return;
  await saveUserState(FOLDERS_KEY, { v: 1, docs: sync.folderDocs } satisfies MusicFoldersRow);
}

/** Get the set of locally-stored event IDs (not published to relays) */
export async function getLocalEventIds(): Promise<Set<string>> {
  const ids = await getUserState<string[]>(LOCAL_IDS_KEY);
  return new Set(ids ?? []);
}

/** Add an event ID to the local-only set */
export async function addLocalEventId(id: string): Promise<void> {
  const ids = await getLocalEventIds();
  ids.add(id);
  await saveUserState(LOCAL_IDS_KEY, [...ids]);
}

/** Remove an event ID from the local-only set (e.g. after publishing) */
export async function removeLocalEventId(id: string): Promise<void> {
  const ids = await getLocalEventIds();
  ids.delete(id);
  await saveUserState(LOCAL_IDS_KEY, [...ids]);
}
