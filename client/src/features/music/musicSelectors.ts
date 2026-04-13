import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import type { ArtistEntry, MusicVisibility } from "@/types/music";

const selectMusicState = (state: RootState) => state.music;
const selectIdentityPubkey = (state: RootState) => state.identity.pubkey;

/** Check if a music item is visible to the given viewer (for public-facing views) */
function isVisibleTo(
  item: { visibility: MusicVisibility; pubkey: string; artistPubkeys: string[]; featuredArtists: string[]; collaborators: string[] },
  viewerPubkey: string | null,
): boolean {
  if (item.visibility === "public") return true;
  if (!viewerPubkey) return false;
  return item.pubkey === viewerPubkey ||
    item.artistPubkeys.includes(viewerPubkey) ||
    item.featuredArtists.includes(viewerPubkey) ||
    item.collaborators.includes(viewerPubkey);
}

/** Check if a track is in the user's library (saved or own) */
function isTrackInLibrary(track: { addressableId: string; pubkey: string } | undefined, librarySet: Set<string>, userPubkey: string | null): boolean {
  if (!track) return false;
  return librarySet.has(track.addressableId) || track.pubkey === userPubkey;
}

/** Check if an album is in the user's library (saved or own) */
function isAlbumInLibrary(album: { addressableId: string; pubkey: string } | undefined, librarySet: Set<string>, userPubkey: string | null): boolean {
  if (!album) return false;
  return librarySet.has(album.addressableId) || album.pubkey === userPubkey;
}

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

export const selectArtistTracks = (artistPubkey: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, userPubkey) => {
    const ids = music.tracksByArtist[artistPubkey] ?? [];
    const librarySet = new Set(music.library.savedTrackIds);
    return ids
      .map((id) => music.tracks[id])
      .filter((t) => isTrackInLibrary(t, librarySet, userPubkey))
      .filter((t) => isVisibleTo(t, userPubkey));
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

/** Albums where user is listed as a collaborator or featured artist but not the owner */
export const selectMyCollaborations = (pubkey: string) =>
  createSelector(selectMusicState, (music) =>
    Object.values(music.albums)
      .filter((a) =>
        a.pubkey !== pubkey &&
        (a.featuredArtists.includes(pubkey) || a.collaborators.includes(pubkey)),
      )
      .sort((a, b) => b.createdAt - a.createdAt),
  );

/** Unified artist directory merging pubkey-linked and text-only artists -- library + own content only */
export const selectArtistDirectory = createSelector(
  selectMusicState,
  selectIdentityPubkey,
  (music, userPubkey): ArtistEntry[] => {
    const entries: ArtistEntry[] = [];
    const seenPubkeys = new Set<string>();

    // Build sets of library content (saved IDs)
    const libraryTrackSet = new Set(music.library.savedTrackIds);
    const libraryAlbumSet = new Set(music.library.savedAlbumIds);

    // Count only library+own tracks/albums per artist pubkey
    const pubkeyTrackCounts = new Map<string, number>();
    const pubkeyAlbumCounts = new Map<string, number>();

    for (const [pk, ids] of Object.entries(music.tracksByArtist)) {
      const count = ids.filter((id) => {
        const t = music.tracks[id];
        return t && (libraryTrackSet.has(id) || t.pubkey === userPubkey);
      }).length;
      if (count > 0) pubkeyTrackCounts.set(pk, count);
    }
    for (const [pk, ids] of Object.entries(music.albumsByArtist)) {
      const count = ids.filter((id) => {
        const a = music.albums[id];
        return a && (libraryAlbumSet.has(id) || a.pubkey === userPubkey);
      }).length;
      if (count > 0) pubkeyAlbumCounts.set(pk, count);
    }

    // Merge pubkey sets
    for (const pk of pubkeyTrackCounts.keys()) seenPubkeys.add(pk);
    for (const pk of pubkeyAlbumCounts.keys()) seenPubkeys.add(pk);

    for (const pk of seenPubkeys) {
      const trackCount = pubkeyTrackCounts.get(pk) ?? 0;
      const albumCount = pubkeyAlbumCounts.get(pk) ?? 0;
      entries.push({ type: "pubkey", pubkey: pk, trackCount, albumCount });
    }

    // Count only library+own tracks/albums per artist name
    const nameTrackCounts = new Map<string, number>();
    const nameAlbumCounts = new Map<string, number>();

    for (const [name, ids] of Object.entries(music.tracksByArtistName)) {
      const count = ids.filter((id) => {
        const t = music.tracks[id];
        return t && (libraryTrackSet.has(id) || t.pubkey === userPubkey);
      }).length;
      if (count > 0) nameTrackCounts.set(name, count);
    }
    for (const [name, ids] of Object.entries(music.albumsByArtistName)) {
      const count = ids.filter((id) => {
        const a = music.albums[id];
        return a && (libraryAlbumSet.has(id) || a.pubkey === userPubkey);
      }).length;
      if (count > 0) nameAlbumCounts.set(name, count);
    }

    const seenNames = new Set<string>();
    for (const name of nameTrackCounts.keys()) seenNames.add(name);
    for (const name of nameAlbumCounts.keys()) seenNames.add(name);

    for (const name of seenNames) {
      const trackCount = nameTrackCounts.get(name) ?? 0;
      const albumCount = nameAlbumCounts.get(name) ?? 0;
      // Find a display name from a track that uses this artist name
      const firstTrackId = music.tracksByArtistName[name]?.[0] ?? music.albumsByArtistName[name]?.[0];
      const displayName = firstTrackId
        ? (music.tracks[firstTrackId]?.artist ?? music.albums[firstTrackId]?.artist ?? name)
        : name;
      entries.push({ type: "name", name: displayName, normalizedName: name, trackCount, albumCount });
    }

    // Sort by total content count descending
    entries.sort((a, b) => (b.trackCount + b.albumCount) - (a.trackCount + a.albumCount));
    return entries;
  },
);

/** Tracks for a text-only artist (by normalized name) -- library only */
export const selectArtistNameTracks = (normalizedName: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, userPubkey) => {
    const ids = music.tracksByArtistName[normalizedName] ?? [];
    const librarySet = new Set(music.library.savedTrackIds);
    return ids.map((id) => music.tracks[id]).filter((t) => isTrackInLibrary(t, librarySet, userPubkey));
  });

/** Albums for a text-only artist (by normalized name) -- library only */
export const selectArtistNameAlbums = (normalizedName: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, userPubkey) => {
    const ids = music.albumsByArtistName[normalizedName] ?? [];
    const librarySet = new Set(music.library.savedAlbumIds);
    return ids.map((id) => music.albums[id]).filter((a) => isAlbumInLibrary(a, librarySet, userPubkey));
  });

/** Albums where pubkey is artist or featured -- library only */
export const selectArtistAlbums = (artistPubkey: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, userPubkey) => {
    const ids = music.albumsByArtist[artistPubkey] ?? [];
    const librarySet = new Set(music.library.savedAlbumIds);
    return ids
      .map((id) => music.albums[id])
      .filter((a) => isAlbumInLibrary(a, librarySet, userPubkey))
      .filter((a) => isVisibleTo(a, userPubkey));
  });

/** Tracks where pubkey is owner, artist, or featured artist -- for profile display (no library filter) */
export const selectProfileTracks = (pubkey: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, viewerPubkey) => {
    // Start with indexed tracks for this pubkey
    const indexedIds = new Set(music.tracksByArtist[pubkey] ?? []);
    // Also scan for owner match (pubkey field) and featured artist inclusion
    const all = Object.values(music.tracks).filter(
      (t) =>
        (t.pubkey === pubkey ||
         indexedIds.has(t.addressableId) ||
         t.artistPubkeys.includes(pubkey) ||
         t.featuredArtists.includes(pubkey)) &&
        // Visibility: only show non-public to owner/collaborators
        isVisibleTo(t, viewerPubkey),
    );
    // Deduplicate by addressableId and sort newest first
    const seen = new Set<string>();
    return all
      .filter((t) => {
        if (seen.has(t.addressableId)) return false;
        seen.add(t.addressableId);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  });

/** Albums where pubkey is owner, artist, or featured -- for profile display (no library filter) */
export const selectProfileAlbums = (pubkey: string) =>
  createSelector(selectMusicState, selectIdentityPubkey, (music, viewerPubkey) => {
    const indexedIds = new Set(music.albumsByArtist[pubkey] ?? []);
    const all = Object.values(music.albums).filter(
      (a) =>
        (a.pubkey === pubkey ||
         indexedIds.has(a.addressableId) ||
         a.artistPubkeys.includes(pubkey) ||
         a.featuredArtists.includes(pubkey)) &&
        // Visibility: only show non-public to owner/collaborators
        isVisibleTo(a, viewerPubkey),
    );
    const seen = new Set<string>();
    return all
      .filter((a) => {
        if (seen.has(a.addressableId)) return false;
        seen.add(a.addressableId);
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  });
