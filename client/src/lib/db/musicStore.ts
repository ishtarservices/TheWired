import { saveUserState, getUserState } from "./userStateStore";

const LIBRARY_KEY = "music_library";
const LOCAL_IDS_KEY = "music_local_ids";

interface MusicLibraryState {
  savedTrackIds: string[];
  savedAlbumIds: string[];
  followedArtists: string[];
  userPlaylists: string[];
  recentlyPlayedIds: string[];
}

/** Load music library state from IndexedDB */
export async function loadMusicLibrary(): Promise<MusicLibraryState | undefined> {
  return getUserState<MusicLibraryState>(LIBRARY_KEY);
}

/** Save music library state to IndexedDB */
export async function saveMusicLibrary(library: MusicLibraryState): Promise<void> {
  await saveUserState(LIBRARY_KEY, library);
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
