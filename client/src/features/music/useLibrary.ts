import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addSavedTrack,
  removeSavedTrack,
  addSavedAlbum,
  removeSavedAlbum,
  addFollowedArtist,
  removeFollowedArtist,
} from "@/store/slices/musicSlice";
import { store } from "@/store";
import { saveMusicLibrary } from "@/lib/db/musicStore";

/** Persist current library state to IndexedDB */
function persistLibrary() {
  const { savedTrackIds, savedAlbumIds, followedArtists, userPlaylists } =
    store.getState().music.library;
  const { recentlyPlayedIds } = store.getState().music.discovery;
  saveMusicLibrary({
    savedTrackIds,
    savedAlbumIds,
    followedArtists,
    userPlaylists,
    recentlyPlayedIds,
  });
}

/**
 * Library management hook.
 *
 * In the future, saveTrack/unsaveTrack should also publish kind:10003 bookmark
 * events, and followArtist/unfollowArtist should publish kind:30000 follow set
 * events. For now, they update local Redux state and persist to IndexedDB.
 */
export function useLibrary() {
  const dispatch = useAppDispatch();
  const savedTrackIds = useAppSelector((s) => s.music.library.savedTrackIds);
  const savedAlbumIds = useAppSelector((s) => s.music.library.savedAlbumIds);
  const followedArtists = useAppSelector((s) => s.music.library.followedArtists);

  const saveTrack = useCallback(
    (addrId: string) => {
      dispatch(addSavedTrack(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const unsaveTrack = useCallback(
    (addrId: string) => {
      dispatch(removeSavedTrack(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const isTrackSaved = useCallback(
    (addrId: string) => savedTrackIds.includes(addrId),
    [savedTrackIds],
  );

  const saveAlbum = useCallback(
    (addrId: string) => {
      dispatch(addSavedAlbum(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const unsaveAlbum = useCallback(
    (addrId: string) => {
      dispatch(removeSavedAlbum(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const isAlbumSaved = useCallback(
    (addrId: string) => savedAlbumIds.includes(addrId),
    [savedAlbumIds],
  );

  const followArtist = useCallback(
    (pubkey: string) => {
      dispatch(addFollowedArtist(pubkey));
      persistLibrary();
    },
    [dispatch],
  );

  const unfollowArtist = useCallback(
    (pubkey: string) => {
      dispatch(removeFollowedArtist(pubkey));
      persistLibrary();
    },
    [dispatch],
  );

  const isArtistFollowed = useCallback(
    (pubkey: string) => followedArtists.includes(pubkey),
    [followedArtists],
  );

  return {
    saveTrack,
    unsaveTrack,
    isTrackSaved,
    saveAlbum,
    unsaveAlbum,
    isAlbumSaved,
    followArtist,
    unfollowArtist,
    isArtistFollowed,
  };
}
