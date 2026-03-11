import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import type { ArtistEntry } from "@/types/music";

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

export const selectFavoritedTracks = createSelector(
  selectMusicState,
  (music) =>
    music.library.favoritedTrackIds
      .map((id) => music.tracks[id])
      .filter(Boolean),
);

export const selectFavoritedAlbums = createSelector(
  selectMusicState,
  (music) =>
    music.library.favoritedAlbumIds
      .map((id) => music.albums[id])
      .filter(Boolean),
);

export const selectSavedAlbums = createSelector(
  selectMusicState,
  (music) =>
    music.library.savedAlbumIds
      .map((id) => music.albums[id])
      .filter(Boolean),
);

/** Saved tracks + own tracks (deduped), for library views like Home/Recently Added/Songs */
export const selectLibraryTracks = (pubkey: string | null) =>
  createSelector(selectMusicState, (music) => {
    const saved = music.library.savedTrackIds
      .map((id) => music.tracks[id])
      .filter(Boolean);
    if (!pubkey) return saved;

    const savedSet = new Set(music.library.savedTrackIds);
    const ownExtras = Object.values(music.tracks)
      .filter((t) => t.pubkey === pubkey && !savedSet.has(t.addressableId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return [...saved, ...ownExtras];
  });

/** Saved albums + own albums (deduped) */
export const selectLibraryAlbums = (pubkey: string | null) =>
  createSelector(selectMusicState, (music) => {
    const saved = music.library.savedAlbumIds
      .map((id) => music.albums[id])
      .filter(Boolean);
    if (!pubkey) return saved;

    const savedSet = new Set(music.library.savedAlbumIds);
    const ownExtras = Object.values(music.albums)
      .filter((a) => a.pubkey === pubkey && !savedSet.has(a.addressableId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return [...saved, ...ownExtras];
  });

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

/** Unified artist directory merging pubkey-linked and text-only artists */
export const selectArtistDirectory = createSelector(
  selectMusicState,
  (music): ArtistEntry[] => {
    const entries: ArtistEntry[] = [];
    const seenPubkeys = new Set<string>();

    // Pubkey-based artists from tracksByArtist + albumsByArtist
    for (const pk of Object.keys(music.tracksByArtist)) {
      if (!seenPubkeys.has(pk)) seenPubkeys.add(pk);
    }
    for (const pk of Object.keys(music.albumsByArtist)) {
      if (!seenPubkeys.has(pk)) seenPubkeys.add(pk);
    }
    for (const pk of seenPubkeys) {
      const trackCount = music.tracksByArtist[pk]?.length ?? 0;
      const albumCount = music.albumsByArtist[pk]?.length ?? 0;
      if (trackCount > 0 || albumCount > 0) {
        entries.push({ type: "pubkey", pubkey: pk, trackCount, albumCount });
      }
    }

    // Text-only artists from tracksByArtistName + albumsByArtistName
    const seenNames = new Set<string>();
    for (const name of Object.keys(music.tracksByArtistName)) {
      if (!seenNames.has(name)) seenNames.add(name);
    }
    for (const name of Object.keys(music.albumsByArtistName)) {
      if (!seenNames.has(name)) seenNames.add(name);
    }
    for (const name of seenNames) {
      const trackCount = music.tracksByArtistName[name]?.length ?? 0;
      const albumCount = music.albumsByArtistName[name]?.length ?? 0;
      if (trackCount > 0 || albumCount > 0) {
        // Find a display name from a track that uses this artist name
        const firstTrackId = music.tracksByArtistName[name]?.[0] ?? music.albumsByArtistName[name]?.[0];
        const displayName = firstTrackId
          ? (music.tracks[firstTrackId]?.artist ?? music.albums[firstTrackId]?.artist ?? name)
          : name;
        entries.push({ type: "name", name: displayName, normalizedName: name, trackCount, albumCount });
      }
    }

    // Sort by total content count descending
    entries.sort((a, b) => (b.trackCount + b.albumCount) - (a.trackCount + a.albumCount));
    return entries;
  },
);

/** Tracks for a text-only artist (by normalized name) */
export const selectArtistNameTracks = (normalizedName: string) =>
  createSelector(selectMusicState, (music) => {
    const ids = music.tracksByArtistName[normalizedName] ?? [];
    return ids.map((id) => music.tracks[id]).filter(Boolean);
  });

/** Albums for a text-only artist (by normalized name) */
export const selectArtistNameAlbums = (normalizedName: string) =>
  createSelector(selectMusicState, (music) => {
    const ids = music.albumsByArtistName[normalizedName] ?? [];
    return ids.map((id) => music.albums[id]).filter(Boolean);
  });

/** Albums where pubkey is artist or featured */
export const selectArtistAlbums = (pubkey: string) =>
  createSelector(selectMusicState, (music) => {
    const ids = music.albumsByArtist[pubkey] ?? [];
    return ids.map((id) => music.albums[id]).filter(Boolean);
  });
