import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  addSavedTrack,
  removeSavedTrack,
  addSavedAlbum,
  removeSavedAlbum,
  addFavoritedTrack,
  removeFavoritedTrack,
  addFavoritedAlbum,
  removeFavoritedAlbum,
  addFollowedArtist,
  removeFollowedArtist,
  indexAlbumByArtist,
  indexAlbumByArtistName,
  indexTrackByArtist,
  indexTrackByArtistName,
  indexTrackByAlbum,
  removeDownloadedTrack,
} from "@/store/slices/musicSlice";
import { removeCachedAudio } from "@/lib/db/audioCache";
import { store } from "@/store";
import { saveMusicLibrary } from "@/lib/db/musicStore";
import { getApiBaseUrl } from "@/lib/api/client";
import { buildNip98Header } from "@/lib/api/nip98";

/** Persist current library state to IndexedDB */
function persistLibrary() {
  const { savedTrackIds, savedAlbumIds, favoritedTrackIds, favoritedAlbumIds, followedArtists, userPlaylists } =
    store.getState().music.library;
  const { recentlyPlayedIds } = store.getState().music.discovery;
  saveMusicLibrary({
    savedTrackIds,
    savedAlbumIds,
    favoritedTrackIds,
    favoritedAlbumIds,
    followedArtists,
    userPlaylists,
    recentlyPlayedIds,
  }).catch((err) => console.error("[music] Failed to persist library:", err));
}

/**
 * Ensure an album and its tracks are properly indexed in artist/album maps.
 * Mirrors the same branching logic as eventPipeline to avoid creating
 * duplicate artist entries (e.g. uploader pubkey vs text-only artist name).
 */
function ensureAlbumIndexed(dispatch: ReturnType<typeof useAppDispatch>, addrId: string) {
  const state = store.getState().music;
  const album = state.albums[addrId];
  if (!album) return;

  // Index album — same logic as eventPipeline MUSIC_ALBUM handler
  if (album.artistPubkeys.length > 0) {
    for (const pk of album.artistPubkeys) {
      dispatch(indexAlbumByArtist({ pubkey: pk, addressableId: addrId }));
    }
  } else if (album.artist && album.artist !== album.pubkey) {
    // Text-only artist — index by normalized name only, NOT by uploader pubkey
    dispatch(indexAlbumByArtistName({ normalizedName: album.artist.toLowerCase().trim(), addressableId: addrId }));
  } else {
    // Legacy fallback: uploader is the artist
    dispatch(indexAlbumByArtist({ pubkey: album.pubkey, addressableId: addrId }));
  }
  // Also index by each featured artist
  for (const pk of album.featuredArtists) {
    dispatch(indexAlbumByArtist({ pubkey: pk, addressableId: addrId }));
  }

  // Index the album's tracks — same logic as eventPipeline MUSIC_TRACK handler
  const trackRefs = album.trackRefs.length > 0 ? album.trackRefs : state.tracksByAlbum[addrId] ?? [];
  for (const trackId of trackRefs) {
    const track = state.tracks[trackId];
    if (!track) continue;

    // Index track → album
    dispatch(indexTrackByAlbum({ albumAddrId: addrId, trackAddrId: trackId }));

    // Index by artist — mirror eventPipeline branching
    if (track.artistPubkeys.length > 0) {
      for (const pk of track.artistPubkeys) {
        dispatch(indexTrackByArtist({ pubkey: pk, addressableId: trackId }));
      }
    } else if (track.artist && track.artist !== track.pubkey) {
      dispatch(indexTrackByArtistName({ normalizedName: track.artist.toLowerCase().trim(), addressableId: trackId }));
    } else {
      dispatch(indexTrackByArtist({ pubkey: track.pubkey, addressableId: trackId }));
    }
    // Also index by each featured artist
    for (const pk of track.featuredArtists) {
      dispatch(indexTrackByArtist({ pubkey: pk, addressableId: trackId }));
    }
  }
}

/**
 * Library management hook.
 *
 * Library (plus icon) = "add to collection" -- tracks/albums appear in your library tabs.
 * Favorites (heart icon) = "mark as favorite" -- tracks/albums appear in Favorites tab.
 */
export function useLibrary() {
  const dispatch = useAppDispatch();
  const savedTrackIds = useAppSelector((s) => s.music.library.savedTrackIds);
  const savedAlbumIds = useAppSelector((s) => s.music.library.savedAlbumIds);
  const favoritedTrackIds = useAppSelector((s) => s.music.library.favoritedTrackIds);
  const favoritedAlbumIds = useAppSelector((s) => s.music.library.favoritedAlbumIds);
  const followedArtists = useAppSelector((s) => s.music.library.followedArtists);

  // ── Library (save/unsave) ──────────────────────────────

  const saveTrack = useCallback(
    (addrId: string) => {
      dispatch(addSavedTrack(addrId));

      // Auto-add parent album to library (without cascading other tracks)
      const state = store.getState().music;
      const track = state.tracks[addrId];
      if (track?.albumRef && !state.library.savedAlbumIds.includes(track.albumRef)) {
        dispatch(addSavedAlbum(track.albumRef));
        ensureAlbumIndexed(dispatch, track.albumRef);
      }

      persistLibrary();
    },
    [dispatch],
  );

  const unsaveTrack = useCallback(
    (addrId: string) => {
      dispatch(removeSavedTrack(addrId));

      // State after the track was removed from savedTrackIds
      const state = store.getState().music;
      const track = state.tracks[addrId];

      // Also remove from favorites if favorited
      if (state.library.favoritedTrackIds.includes(addrId)) {
        dispatch(removeFavoritedTrack(addrId));
      }

      // Auto-remove parent album if no tracks from it remain in library
      if (track?.albumRef && state.library.savedAlbumIds.includes(track.albumRef)) {
        const album = state.albums[track.albumRef];
        if (album) {
          const trackRefs = album.trackRefs.length > 0
            ? album.trackRefs
            : state.tracksByAlbum[track.albumRef] ?? [];
          const hasAnySavedTracks = trackRefs.some(
            (tid) => state.library.savedTrackIds.includes(tid),
          );
          if (!hasAnySavedTracks) {
            dispatch(removeSavedAlbum(track.albumRef));
            if (state.library.favoritedAlbumIds.includes(track.albumRef)) {
              dispatch(removeFavoritedAlbum(track.albumRef));
            }
          }
        }
      }

      // Clean up cached audio
      removeCachedAudio(addrId).then(() => {
        dispatch(removeDownloadedTrack(addrId));
      }).catch((err) => console.debug("[music] Failed to remove cached audio:", err));
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

      // Ensure album + tracks are indexed so they appear in Artists/Songs tabs
      ensureAlbumIndexed(dispatch, addrId);

      // Cascade: auto-save the album's tracks
      const state = store.getState().music;
      const album = state.albums[addrId];
      if (album) {
        const trackRefs = album.trackRefs.length > 0
          ? album.trackRefs
          : state.tracksByAlbum[addrId] ?? [];
        const savedSet = new Set(state.library.savedTrackIds);
        for (const trackId of trackRefs) {
          if (!savedSet.has(trackId)) {
            dispatch(addSavedTrack(trackId));
          }
        }

        // Auto-follow the album artist — only if the artist is a pubkey-based
        // identity, not a text-only artist name (otherwise we'd follow the uploader)
        const artistPk = album.artistPubkeys.length > 0
          ? album.artistPubkeys[0]
          : (album.artist === album.pubkey ? album.pubkey : null);
        if (artistPk && !state.library.followedArtists.includes(artistPk)) {
          dispatch(addFollowedArtist(artistPk));
        }
      }

      persistLibrary();

      // Save version to backend for update notifications
      if (album) {
        const url = `${getApiBaseUrl()}/music/save-version`;
        buildNip98Header(url, "POST")
          .then((auth) =>
            fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: auth },
              body: JSON.stringify({
                addressableId: addrId,
                eventId: album.eventId,
                createdAt: album.createdAt,
              }),
            }),
          )
          .catch((err) => console.debug("[music] Failed to save version:", err));
      }
    },
    [dispatch],
  );

  const unsaveAlbum = useCallback(
    (addrId: string) => {
      const state = store.getState().music;
      const album = state.albums[addrId];

      dispatch(removeSavedAlbum(addrId));

      // Also remove from favorites
      if (state.library.favoritedAlbumIds.includes(addrId)) {
        dispatch(removeFavoritedAlbum(addrId));
      }

      // Cascade: remove the album's tracks from library + clear cached audio
      if (album) {
        const trackRefs = album.trackRefs.length > 0
          ? album.trackRefs
          : state.tracksByAlbum[addrId] ?? [];
        for (const trackId of trackRefs) {
          dispatch(removeSavedTrack(trackId));
          dispatch(removeFavoritedTrack(trackId));
          // Clean up cached audio
          removeCachedAudio(trackId).then(() => {
            dispatch(removeDownloadedTrack(trackId));
          }).catch((err) => console.debug("[music] Failed to remove cached audio:", err));
        }

        // Determine which pubkey was followed for this album's artist
        const artistPk = album.artistPubkeys.length > 0
          ? album.artistPubkeys[0]
          : (album.artist === album.pubkey ? album.pubkey : null);
        // Check if the artist has any other saved albums; if not, unfollow
        if (artistPk) {
          const remaining = state.library.savedAlbumIds.filter((id) => {
            if (id === addrId) return false;
            const a = state.albums[id];
            if (!a) return false;
            const otherArtistPk = a.artistPubkeys.length > 0
              ? a.artistPubkeys[0]
              : (a.artist === a.pubkey ? a.pubkey : null);
            return otherArtistPk === artistPk;
          });
          if (remaining.length === 0) {
            dispatch(removeFollowedArtist(artistPk));
          }
        }
      }

      persistLibrary();
    },
    [dispatch],
  );

  const isAlbumSaved = useCallback(
    (addrId: string) => savedAlbumIds.includes(addrId),
    [savedAlbumIds],
  );

  // ── Favorites (heart) ──────────────────────────────────

  const favoriteTrack = useCallback(
    (addrId: string) => {
      dispatch(addFavoritedTrack(addrId));
      // Auto-add to library if not already saved
      const state = store.getState().music;
      if (!state.library.savedTrackIds.includes(addrId)) {
        dispatch(addSavedTrack(addrId));
      }
      // Auto-add parent album to library (without cascading other tracks)
      const track = state.tracks[addrId];
      if (track?.albumRef && !state.library.savedAlbumIds.includes(track.albumRef)) {
        dispatch(addSavedAlbum(track.albumRef));
        ensureAlbumIndexed(dispatch, track.albumRef);
      }
      persistLibrary();
    },
    [dispatch],
  );

  const unfavoriteTrack = useCallback(
    (addrId: string) => {
      dispatch(removeFavoritedTrack(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const isTrackFavorited = useCallback(
    (addrId: string) => favoritedTrackIds.includes(addrId),
    [favoritedTrackIds],
  );

  const favoriteAlbum = useCallback(
    (addrId: string) => {
      dispatch(addFavoritedAlbum(addrId));
      // Auto-add to library if not already saved — cascade tracks like saveAlbum
      const state = store.getState().music;
      if (!state.library.savedAlbumIds.includes(addrId)) {
        dispatch(addSavedAlbum(addrId));
        ensureAlbumIndexed(dispatch, addrId);
        const album = state.albums[addrId];
        if (album) {
          const trackRefs = album.trackRefs.length > 0
            ? album.trackRefs
            : state.tracksByAlbum[addrId] ?? [];
          const savedSet = new Set(state.library.savedTrackIds);
          for (const trackId of trackRefs) {
            if (!savedSet.has(trackId)) {
              dispatch(addSavedTrack(trackId));
            }
          }
        }
      }
      persistLibrary();
    },
    [dispatch],
  );

  const unfavoriteAlbum = useCallback(
    (addrId: string) => {
      dispatch(removeFavoritedAlbum(addrId));
      persistLibrary();
    },
    [dispatch],
  );

  const isAlbumFavorited = useCallback(
    (addrId: string) => favoritedAlbumIds.includes(addrId),
    [favoritedAlbumIds],
  );

  // ── Artists ────────────────────────────────────────────

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
    favoriteTrack,
    unfavoriteTrack,
    isTrackFavorited,
    favoriteAlbum,
    unfavoriteAlbum,
    isAlbumFavorited,
    followArtist,
    unfollowArtist,
    isArtistFollowed,
  };
}
