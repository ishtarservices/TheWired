import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store";

const selectMusicState = (state: RootState) => state.music;

export const selectAllTracks = createSelector(
  selectMusicState,
  (music) => Object.values(music.tracks),
);

export const selectSavedTracks = createSelector(
  selectMusicState,
  (music) =>
    music.library.savedTrackIds
      .map((id) => music.tracks[id])
      .filter(Boolean),
);

export const selectSavedAlbums = createSelector(
  selectMusicState,
  (music) =>
    music.library.savedAlbumIds
      .map((id) => music.albums[id])
      .filter(Boolean),
);

export const selectArtistTracks = (pubkey: string) =>
  createSelector(selectMusicState, (music) => {
    const ids = music.tracksByArtist[pubkey] ?? [];
    return ids.map((id) => music.tracks[id]).filter(Boolean);
  });

export const selectAlbumTracks = (albumId: string) =>
  createSelector(selectMusicState, (music) => {
    const album = music.albums[albumId];
    const refs = album?.trackRefs ?? music.tracksByAlbum[albumId] ?? [];
    return refs.map((id) => music.tracks[id]).filter(Boolean);
  });

export const selectPlaylistTracks = (playlistId: string) =>
  createSelector(selectMusicState, (music) => {
    const pl = music.playlists[playlistId];
    if (!pl) return [];
    return pl.trackRefs.map((id) => music.tracks[id]).filter(Boolean);
  });

export const selectCurrentTrack = createSelector(
  selectMusicState,
  (music) =>
    music.player.currentTrackId
      ? music.tracks[music.player.currentTrackId]
      : null,
);

export const selectCurrentQueue = createSelector(
  selectMusicState,
  (music) =>
    music.player.queue.map((id) => music.tracks[id]).filter(Boolean),
);

export const selectFollowedArtists = createSelector(
  selectMusicState,
  (music) => music.library.followedArtists,
);

export const selectUserPlaylists = createSelector(
  selectMusicState,
  (music) =>
    music.library.userPlaylists
      .map((id) => music.playlists[id])
      .filter(Boolean),
);

export const selectMyTracks = (pubkey: string) =>
  createSelector(selectMusicState, (music) =>
    Object.values(music.tracks)
      .filter((t) => t.pubkey === pubkey)
      .sort((a, b) => b.createdAt - a.createdAt),
  );

export const selectMyAlbums = (pubkey: string) =>
  createSelector(selectMusicState, (music) =>
    Object.values(music.albums)
      .filter((a) => a.pubkey === pubkey)
      .sort((a, b) => b.createdAt - a.createdAt),
  );

/** Albums where user is listed as a collaborator (featured artist) but not the owner */
export const selectMyCollaborations = (pubkey: string) =>
  createSelector(selectMusicState, (music) =>
    Object.values(music.albums)
      .filter((a) => a.pubkey !== pubkey && a.featuredArtists.includes(pubkey))
      .sort((a, b) => b.createdAt - a.createdAt),
  );
