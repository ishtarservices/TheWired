import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MusicTrack, MusicAlbum, MusicPlaylist, MusicView, RepeatMode, TrackNotes, MusicRevision, TrackInsights, MusicProposal, SavedAlbumVersion } from "../../types/music";

interface MusicState {
  tracks: Record<string, MusicTrack>;
  albums: Record<string, MusicAlbum>;
  playlists: Record<string, MusicPlaylist>;
  trackNotes: Record<string, TrackNotes>;
  revisions: Record<string, MusicRevision[]>;
  insights: Record<string, TrackInsights>;
  proposals: Record<string, MusicProposal[]>;
  savedVersions: Record<string, SavedAlbumVersion>;
  tracksByArtist: Record<string, string[]>;
  tracksByArtistName: Record<string, string[]>;
  tracksByAlbum: Record<string, string[]>;
  albumsByArtist: Record<string, string[]>;
  albumsByArtistName: Record<string, string[]>;

  library: {
    savedTrackIds: string[];
    savedAlbumIds: string[];
    favoritedTrackIds: string[];
    favoritedAlbumIds: string[];
    followedArtists: string[];
    userPlaylists: string[];
  };

  player: {
    currentTrackId: string | null;
    queue: string[];
    queueIndex: number;
    position: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
    isMuted: boolean;
    repeat: RepeatMode;
    shuffle: boolean;
    originalQueue: string[];
  };

  discovery: {
    trendingTrackIds: string[];
    trendingAlbumIds: string[];
    recentlyPlayedIds: string[];
    newReleaseIds: string[];
    undergroundTrackIds: string[];
    recommendedTrackIds: string[];
  };

  explore: {
    genres: { genre: string; count: number }[];
    popularTags: { tag: string; count: number }[];
    activeGenre: string | null;
    activeTag: string | null;
    browseResults: string[];
    browseAlbumResults: string[];
    browseSort: "trending" | "recent" | "plays";
    browseTab: "tracks" | "albums";
    isLoading: boolean;
  };

  search: {
    query: string;
    trackResults: string[]; // addressableIds
    albumResults: string[]; // addressableIds
    isLoading: boolean;
  };

  downloadedTrackIds: string[];

  previousView: MusicView | null;

  activeView: MusicView;
  activeDetailId: string | null;
  queueVisible: boolean;
  viewMode: "grid" | "list";
}

const initialState: MusicState = {
  tracks: {},
  albums: {},
  playlists: {},
  trackNotes: {},
  revisions: {},
  insights: {},
  proposals: {},
  savedVersions: {},
  tracksByArtist: {},
  tracksByArtistName: {},
  tracksByAlbum: {},
  albumsByArtist: {},
  albumsByArtistName: {},

  library: {
    savedTrackIds: [],
    savedAlbumIds: [],
    favoritedTrackIds: [],
    favoritedAlbumIds: [],
    followedArtists: [],
    userPlaylists: [],
  },

  player: {
    currentTrackId: null,
    queue: [],
    queueIndex: 0,
    position: 0,
    duration: 0,
    isPlaying: false,
    volume: 0.7,
    isMuted: false,
    repeat: "none",
    shuffle: false,
    originalQueue: [],
  },

  discovery: {
    trendingTrackIds: [],
    trendingAlbumIds: [],
    recentlyPlayedIds: [],
    newReleaseIds: [],
    undergroundTrackIds: [],
    recommendedTrackIds: [],
  },

  explore: {
    genres: [],
    popularTags: [],
    activeGenre: null,
    activeTag: null,
    browseResults: [],
    browseAlbumResults: [],
    browseSort: "trending",
    browseTab: "tracks",
    isLoading: false,
  },

  search: {
    query: "",
    trackResults: [],
    albumResults: [],
    isLoading: false,
  },

  downloadedTrackIds: [],

  previousView: null,

  activeView: "home",
  activeDetailId: null,
  queueVisible: false,
  viewMode: "grid",
};

function pushUnique(arr: string[], id: string) {
  if (!arr.includes(id)) arr.push(id);
}

export const musicSlice = createSlice({
  name: "music",
  initialState,
  reducers: {
    // ── Catalog ─────────────────────────────────────────────
    addTrack(state, action: PayloadAction<MusicTrack>) {
      const existing = state.tracks[action.payload.addressableId];
      if (!existing || action.payload.createdAt >= existing.createdAt) {
        state.tracks[action.payload.addressableId] = action.payload;
      }
    },
    addTracks(state, action: PayloadAction<MusicTrack[]>) {
      for (const t of action.payload) {
        const existing = state.tracks[t.addressableId];
        if (!existing || t.createdAt >= existing.createdAt) {
          state.tracks[t.addressableId] = t;
        }
      }
    },
    addAlbum(state, action: PayloadAction<MusicAlbum>) {
      const existing = state.albums[action.payload.addressableId];
      if (!existing || action.payload.createdAt >= existing.createdAt) {
        state.albums[action.payload.addressableId] = action.payload;
      }
    },
    addAlbums(state, action: PayloadAction<MusicAlbum[]>) {
      for (const a of action.payload) {
        const existing = state.albums[a.addressableId];
        if (!existing || a.createdAt >= existing.createdAt) {
          state.albums[a.addressableId] = a;
        }
      }
    },
    addPlaylist(state, action: PayloadAction<MusicPlaylist>) {
      const existing = state.playlists[action.payload.addressableId];
      if (!existing || action.payload.createdAt >= existing.createdAt) {
        state.playlists[action.payload.addressableId] = action.payload;
      }
    },
    addPlaylists(state, action: PayloadAction<MusicPlaylist[]>) {
      for (const p of action.payload) {
        const existing = state.playlists[p.addressableId];
        if (!existing || p.createdAt >= existing.createdAt) {
          state.playlists[p.addressableId] = p;
        }
      }
    },
    setTrackNotes(state, action: PayloadAction<TrackNotes>) {
      state.trackNotes[action.payload.trackRef] = action.payload;
    },
    setRevisions(state, action: PayloadAction<{ addressableId: string; revisions: MusicRevision[] }>) {
      state.revisions[action.payload.addressableId] = action.payload.revisions;
    },
    setInsights(state, action: PayloadAction<{ addressableId: string; insights: TrackInsights }>) {
      state.insights[action.payload.addressableId] = action.payload.insights;
    },
    setProposals(state, action: PayloadAction<{ albumId: string; proposals: MusicProposal[] }>) {
      state.proposals[action.payload.albumId] = action.payload.proposals;
    },
    setSavedVersions(state, action: PayloadAction<Record<string, SavedAlbumVersion>>) {
      state.savedVersions = action.payload;
    },
    markVersionUpdate(state, action: PayloadAction<{ addressableId: string; hasUpdate: boolean }>) {
      const ver = state.savedVersions[action.payload.addressableId];
      if (ver) {
        ver.hasUpdate = action.payload.hasUpdate;
      }
    },
    setSavedVersion(state, action: PayloadAction<SavedAlbumVersion>) {
      state.savedVersions[action.payload.addressableId] = action.payload;
    },

    removeTrack(state, action: PayloadAction<string>) {
      const id = action.payload;
      const track = state.tracks[id];
      if (!track) return;

      delete state.tracks[id];

      // Clean up artist pubkey indices
      for (const pk of track.artistPubkeys) {
        const arr = state.tracksByArtist[pk];
        if (arr) state.tracksByArtist[pk] = arr.filter((t) => t !== id);
      }
      // Clean up featured artist indices
      for (const fp of track.featuredArtists) {
        const fpIds = state.tracksByArtist[fp];
        if (fpIds) state.tracksByArtist[fp] = fpIds.filter((t) => t !== id);
      }
      // Clean up legacy uploader-as-artist index
      const uploaderIds = state.tracksByArtist[track.pubkey];
      if (uploaderIds) {
        state.tracksByArtist[track.pubkey] = uploaderIds.filter((t) => t !== id);
      }
      // Clean up artist name index
      if (track.artist) {
        const normalized = track.artist.toLowerCase().trim();
        const nameIds = state.tracksByArtistName[normalized];
        if (nameIds) state.tracksByArtistName[normalized] = nameIds.filter((t) => t !== id);
      }
      // Clean up album index
      if (track.albumRef) {
        const albumTracks = state.tracksByAlbum[track.albumRef];
        if (albumTracks) {
          state.tracksByAlbum[track.albumRef] = albumTracks.filter((t) => t !== id);
        }
      }
      // Clean up library
      state.library.savedTrackIds = state.library.savedTrackIds.filter((t) => t !== id);
      state.library.favoritedTrackIds = state.library.favoritedTrackIds.filter((t) => t !== id);
      // Clean up downloads
      state.downloadedTrackIds = state.downloadedTrackIds.filter((t) => t !== id);
      // Clean up track notes
      delete state.trackNotes[id];
      // Clean up queue — adjust queueIndex to keep pointing at the same track
      const oldQueue = state.player.queue;
      const oldIndex = state.player.queueIndex;
      state.player.queue = oldQueue.filter((t) => t !== id);
      state.player.originalQueue = state.player.originalQueue.filter((t) => t !== id);
      if (state.player.currentTrackId === id) {
        // Current track removed — try to play next, or reset
        state.player.currentTrackId = state.player.queue[Math.min(oldIndex, state.player.queue.length - 1)] ?? null;
        state.player.queueIndex = state.player.currentTrackId
          ? state.player.queue.indexOf(state.player.currentTrackId)
          : 0;
        if (!state.player.currentTrackId) state.player.isPlaying = false;
      } else {
        // Recalculate index — count how many items before the old index were removed
        let removedBefore = 0;
        for (let i = 0; i < oldIndex && i < oldQueue.length; i++) {
          if (oldQueue[i] === id) removedBefore++;
        }
        state.player.queueIndex = oldIndex - removedBefore;
      }
      // Clean up discovery
      state.discovery.trendingTrackIds = state.discovery.trendingTrackIds.filter((t) => t !== id);
      state.discovery.recentlyPlayedIds = state.discovery.recentlyPlayedIds.filter((t) => t !== id);
      state.discovery.newReleaseIds = state.discovery.newReleaseIds.filter((t) => t !== id);
      state.discovery.undergroundTrackIds = state.discovery.undergroundTrackIds.filter((t) => t !== id);
      state.discovery.recommendedTrackIds = state.discovery.recommendedTrackIds.filter((t) => t !== id);
      state.explore.browseResults = state.explore.browseResults.filter((t) => t !== id);
      state.search.trackResults = state.search.trackResults.filter((t) => t !== id);
    },
    removeAlbum(state, action: PayloadAction<string>) {
      const id = action.payload;
      const album = state.albums[id];
      if (album) {
        // Clean up album artist indexes
        for (const pk of album.artistPubkeys) {
          const arr = state.albumsByArtist[pk];
          if (arr) state.albumsByArtist[pk] = arr.filter((a) => a !== id);
        }
        for (const fp of album.featuredArtists) {
          const arr = state.albumsByArtist[fp];
          if (arr) state.albumsByArtist[fp] = arr.filter((a) => a !== id);
        }
        const uploaderArr = state.albumsByArtist[album.pubkey];
        if (uploaderArr) state.albumsByArtist[album.pubkey] = uploaderArr.filter((a) => a !== id);
        if (album.artist) {
          const normalized = album.artist.toLowerCase().trim();
          const nameArr = state.albumsByArtistName[normalized];
          if (nameArr) state.albumsByArtistName[normalized] = nameArr.filter((a) => a !== id);
        }
      }
      delete state.albums[id];
      delete state.tracksByAlbum[id];
      state.library.savedAlbumIds = state.library.savedAlbumIds.filter((a) => a !== id);
      state.library.favoritedAlbumIds = state.library.favoritedAlbumIds.filter((a) => a !== id);
      state.discovery.trendingAlbumIds = state.discovery.trendingAlbumIds.filter((a) => a !== id);
      state.discovery.newReleaseIds = state.discovery.newReleaseIds.filter((a) => a !== id);
      state.search.albumResults = state.search.albumResults.filter((a) => a !== id);
      state.explore.browseAlbumResults = state.explore.browseAlbumResults.filter((a) => a !== id);
      if (state.activeDetailId === id) {
        state.activeDetailId = null;
        state.activeView = "home";
      }
    },
    removePlaylist(state, action: PayloadAction<string>) {
      const id = action.payload;
      delete state.playlists[id];
      state.library.userPlaylists = state.library.userPlaylists.filter((p) => p !== id);
    },

    // ── Indexing ────────────────────────────────────────────
    indexTrackByArtist(
      state,
      action: PayloadAction<{ pubkey: string; addressableId: string }>,
    ) {
      const { pubkey, addressableId } = action.payload;
      if (!state.tracksByArtist[pubkey]) state.tracksByArtist[pubkey] = [];
      pushUnique(state.tracksByArtist[pubkey], addressableId);
    },
    indexTrackByAlbum(
      state,
      action: PayloadAction<{ albumAddrId: string; trackAddrId: string }>,
    ) {
      const { albumAddrId, trackAddrId } = action.payload;
      if (!state.tracksByAlbum[albumAddrId]) state.tracksByAlbum[albumAddrId] = [];
      pushUnique(state.tracksByAlbum[albumAddrId], trackAddrId);
    },
    indexTrackByArtistName(
      state,
      action: PayloadAction<{ normalizedName: string; addressableId: string }>,
    ) {
      const { normalizedName, addressableId } = action.payload;
      if (!state.tracksByArtistName[normalizedName]) state.tracksByArtistName[normalizedName] = [];
      pushUnique(state.tracksByArtistName[normalizedName], addressableId);
    },
    indexAlbumByArtist(
      state,
      action: PayloadAction<{ pubkey: string; addressableId: string }>,
    ) {
      const { pubkey, addressableId } = action.payload;
      if (!state.albumsByArtist[pubkey]) state.albumsByArtist[pubkey] = [];
      pushUnique(state.albumsByArtist[pubkey], addressableId);
    },
    indexAlbumByArtistName(
      state,
      action: PayloadAction<{ normalizedName: string; addressableId: string }>,
    ) {
      const { normalizedName, addressableId } = action.payload;
      if (!state.albumsByArtistName[normalizedName]) state.albumsByArtistName[normalizedName] = [];
      pushUnique(state.albumsByArtistName[normalizedName], addressableId);
    },

    // ── Library ─────────────────────────────────────────────
    setSavedTrackIds(state, action: PayloadAction<string[]>) {
      state.library.savedTrackIds = action.payload;
    },
    addSavedTrack(state, action: PayloadAction<string>) {
      if (!state.library.savedTrackIds.includes(action.payload)) {
        state.library.savedTrackIds = [action.payload, ...state.library.savedTrackIds];
      }
    },
    removeSavedTrack(state, action: PayloadAction<string>) {
      state.library.savedTrackIds = state.library.savedTrackIds.filter(
        (id) => id !== action.payload,
      );
    },
    setSavedAlbumIds(state, action: PayloadAction<string[]>) {
      state.library.savedAlbumIds = action.payload;
    },
    addSavedAlbum(state, action: PayloadAction<string>) {
      if (!state.library.savedAlbumIds.includes(action.payload)) {
        state.library.savedAlbumIds = [action.payload, ...state.library.savedAlbumIds];
      }
    },
    removeSavedAlbum(state, action: PayloadAction<string>) {
      state.library.savedAlbumIds = state.library.savedAlbumIds.filter(
        (id) => id !== action.payload,
      );
    },
    setFavoritedTrackIds(state, action: PayloadAction<string[]>) {
      state.library.favoritedTrackIds = action.payload;
    },
    setFavoritedAlbumIds(state, action: PayloadAction<string[]>) {
      state.library.favoritedAlbumIds = action.payload;
    },
    addFavoritedTrack(state, action: PayloadAction<string>) {
      if (!state.library.favoritedTrackIds.includes(action.payload)) {
        state.library.favoritedTrackIds = [action.payload, ...state.library.favoritedTrackIds];
      }
    },
    removeFavoritedTrack(state, action: PayloadAction<string>) {
      state.library.favoritedTrackIds = state.library.favoritedTrackIds.filter(
        (id) => id !== action.payload,
      );
    },
    addFavoritedAlbum(state, action: PayloadAction<string>) {
      if (!state.library.favoritedAlbumIds.includes(action.payload)) {
        state.library.favoritedAlbumIds = [action.payload, ...state.library.favoritedAlbumIds];
      }
    },
    removeFavoritedAlbum(state, action: PayloadAction<string>) {
      state.library.favoritedAlbumIds = state.library.favoritedAlbumIds.filter(
        (id) => id !== action.payload,
      );
    },

    setFollowedArtists(state, action: PayloadAction<string[]>) {
      state.library.followedArtists = action.payload;
    },
    addFollowedArtist(state, action: PayloadAction<string>) {
      pushUnique(state.library.followedArtists, action.payload);
    },
    removeFollowedArtist(state, action: PayloadAction<string>) {
      state.library.followedArtists = state.library.followedArtists.filter(
        (id) => id !== action.payload,
      );
    },
    setUserPlaylists(state, action: PayloadAction<string[]>) {
      state.library.userPlaylists = action.payload;
    },
    addUserPlaylist(state, action: PayloadAction<string>) {
      pushUnique(state.library.userPlaylists, action.payload);
    },
    removeUserPlaylist(state, action: PayloadAction<string>) {
      state.library.userPlaylists = state.library.userPlaylists.filter(
        (id) => id !== action.payload,
      );
    },

    // ── Player transport ────────────────────────────────────
    setCurrentTrack(
      state,
      action: PayloadAction<{ trackId: string; queue?: string[]; queueIndex?: number }>,
    ) {
      state.player.currentTrackId = action.payload.trackId;
      if (action.payload.queue) {
        state.player.queue = action.payload.queue;
        state.player.originalQueue = action.payload.queue;
      }
      if (action.payload.queueIndex !== undefined) {
        state.player.queueIndex = action.payload.queueIndex;
      }
      state.player.position = 0;
      state.player.isPlaying = true;
    },
    setQueue(state, action: PayloadAction<string[]>) {
      state.player.queue = action.payload;
      state.player.originalQueue = action.payload;
    },
    nextTrack(state) {
      if (state.player.queue.length === 0) return;
      // Note: repeat-one is handled by the onEnded listener (restarts audio directly).
      // The reducer always advances so the Next button works as expected.
      const nextIndex = state.player.queueIndex + 1;
      if (nextIndex < state.player.queue.length) {
        state.player.queueIndex = nextIndex;
        state.player.currentTrackId = state.player.queue[nextIndex];
        state.player.position = 0;
      } else if (state.player.repeat === "all") {
        state.player.queueIndex = 0;
        state.player.currentTrackId = state.player.queue[0];
        state.player.position = 0;
      } else {
        state.player.isPlaying = false;
      }
    },
    prevTrack(state) {
      if (state.player.queue.length === 0) return;
      // If past 3 seconds, restart current track
      if (state.player.position > 3) {
        state.player.position = 0;
        return;
      }
      const prevIndex = state.player.queueIndex - 1;
      if (prevIndex >= 0) {
        state.player.queueIndex = prevIndex;
        state.player.currentTrackId = state.player.queue[prevIndex];
        state.player.position = 0;
      } else if (state.player.repeat === "all") {
        const lastIndex = state.player.queue.length - 1;
        state.player.queueIndex = lastIndex;
        state.player.currentTrackId = state.player.queue[lastIndex];
        state.player.position = 0;
      } else {
        state.player.position = 0;
      }
    },
    togglePlay(state) {
      state.player.isPlaying = !state.player.isPlaying;
    },
    setIsPlaying(state, action: PayloadAction<boolean>) {
      state.player.isPlaying = action.payload;
    },
    updatePosition(state, action: PayloadAction<number>) {
      state.player.position = action.payload;
    },
    setDuration(state, action: PayloadAction<number>) {
      state.player.duration = action.payload;
    },
    setVolume(state, action: PayloadAction<number>) {
      state.player.volume = Math.max(0, Math.min(1, action.payload));
      if (state.player.volume > 0) state.player.isMuted = false;
    },
    toggleMute(state) {
      state.player.isMuted = !state.player.isMuted;
    },
    setRepeat(state, action: PayloadAction<RepeatMode>) {
      state.player.repeat = action.payload;
    },
    toggleShuffle(state) {
      if (!state.player.shuffle) {
        // Enable: Fisher-Yates shuffle, keeping current track at index 0
        const current = state.player.currentTrackId;
        const rest = state.player.queue.filter((id) => id !== current);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        state.player.queue = current ? [current, ...rest] : rest;
        state.player.queueIndex = 0;
      } else {
        // Disable: restore original order
        const current = state.player.currentTrackId;
        state.player.queue = [...state.player.originalQueue];
        state.player.queueIndex = current
          ? state.player.queue.indexOf(current)
          : 0;
        if (state.player.queueIndex < 0) state.player.queueIndex = 0;
      }
      state.player.shuffle = !state.player.shuffle;
    },
    addToQueue(state, action: PayloadAction<string>) {
      state.player.queue.push(action.payload);
      state.player.originalQueue.push(action.payload);
    },
    removeFromQueue(state, action: PayloadAction<number>) {
      const idx = action.payload;
      if (idx >= 0 && idx < state.player.queue.length) {
        const removedId = state.player.queue[idx];
        state.player.queue.splice(idx, 1);
        // Remove only the first occurrence from originalQueue (preserves duplicates)
        const origIdx = state.player.originalQueue.indexOf(removedId);
        if (origIdx !== -1) state.player.originalQueue.splice(origIdx, 1);
        if (idx < state.player.queueIndex) {
          state.player.queueIndex--;
        } else if (idx === state.player.queueIndex) {
          // Current track removed — play next
          if (state.player.queueIndex >= state.player.queue.length) {
            state.player.queueIndex = 0;
          }
          state.player.currentTrackId =
            state.player.queue[state.player.queueIndex] ?? null;
          if (!state.player.currentTrackId) {
            state.player.isPlaying = false;
          }
        }
      }
    },

    // ── Discovery ───────────────────────────────────────────
    setTrendingTrackIds(state, action: PayloadAction<string[]>) {
      state.discovery.trendingTrackIds = action.payload;
    },
    setTrendingAlbumIds(state, action: PayloadAction<string[]>) {
      state.discovery.trendingAlbumIds = action.payload;
    },
    setRecentlyPlayedIds(state, action: PayloadAction<string[]>) {
      state.discovery.recentlyPlayedIds = action.payload;
    },
    addRecentlyPlayed(state, action: PayloadAction<string>) {
      state.discovery.recentlyPlayedIds = [
        action.payload,
        ...state.discovery.recentlyPlayedIds.filter((id) => id !== action.payload),
      ].slice(0, 50);
    },
    setNewReleaseIds(state, action: PayloadAction<string[]>) {
      state.discovery.newReleaseIds = action.payload;
    },
    setUndergroundTrackIds(state, action: PayloadAction<string[]>) {
      state.discovery.undergroundTrackIds = action.payload;
    },
    setRecommendedTrackIds(state, action: PayloadAction<string[]>) {
      state.discovery.recommendedTrackIds = action.payload;
    },

    // ── Explore ──────────────────────────────────────────
    setExploreGenres(state, action: PayloadAction<{ genre: string; count: number }[]>) {
      state.explore.genres = action.payload;
    },
    setExplorePopularTags(state, action: PayloadAction<{ tag: string; count: number }[]>) {
      state.explore.popularTags = action.payload;
    },
    setActiveGenre(state, action: PayloadAction<string | null>) {
      state.explore.activeGenre = action.payload;
    },
    setActiveTag(state, action: PayloadAction<string | null>) {
      state.explore.activeTag = action.payload;
    },
    setExploreResults(state, action: PayloadAction<string[]>) {
      state.explore.browseResults = action.payload;
    },
    setExploreAlbumResults(state, action: PayloadAction<string[]>) {
      state.explore.browseAlbumResults = action.payload;
    },
    setExploreSort(state, action: PayloadAction<"trending" | "recent" | "plays">) {
      state.explore.browseSort = action.payload;
    },
    setExploreTab(state, action: PayloadAction<"tracks" | "albums">) {
      state.explore.browseTab = action.payload;
    },
    setExploreLoading(state, action: PayloadAction<boolean>) {
      state.explore.isLoading = action.payload;
    },

    // ── Search ────────────────────────────────────────────────
    setSearchQuery(state, action: PayloadAction<string>) {
      state.search.query = action.payload;
    },
    setSearchResults(
      state,
      action: PayloadAction<{ trackIds: string[]; albumIds: string[] }>,
    ) {
      state.search.trackResults = action.payload.trackIds;
      state.search.albumResults = action.payload.albumIds;
    },
    setSearchLoading(state, action: PayloadAction<boolean>) {
      state.search.isLoading = action.payload;
    },

    // ── Downloads ─────────────────────────────────────────
    addDownloadedTrack(state, action: PayloadAction<string>) {
      if (!state.downloadedTrackIds.includes(action.payload)) {
        state.downloadedTrackIds.push(action.payload);
      }
    },
    removeDownloadedTrack(state, action: PayloadAction<string>) {
      state.downloadedTrackIds = state.downloadedTrackIds.filter(
        (id) => id !== action.payload,
      );
    },

    // ── UI ──────────────────────────────────────────────────
    setMusicView(state, action: PayloadAction<MusicView>) {
      state.previousView = null;
      state.activeView = action.payload;
      state.activeDetailId = null;
    },
    setActiveDetailId(state, action: PayloadAction<{ view: MusicView; id: string }>) {
      // Save current view so detail views can go back
      state.previousView = state.activeView;
      state.activeView = action.payload.view;
      state.activeDetailId = action.payload.id;
    },
    goBack(state) {
      state.activeView = state.previousView ?? "home";
      state.activeDetailId = null;
      state.previousView = null;
    },
    toggleQueuePanel(state) {
      state.queueVisible = !state.queueVisible;
    },
    setViewMode(state, action: PayloadAction<"grid" | "list">) {
      state.viewMode = action.payload;
    },
  },
});

export const {
  addTrack,
  addTracks,
  addAlbum,
  addAlbums,
  addPlaylist,
  addPlaylists,
  setTrackNotes,
  setRevisions,
  setInsights,
  setProposals,
  setSavedVersions,
  markVersionUpdate,
  setSavedVersion,
  removeTrack,
  removeAlbum,
  removePlaylist,
  indexTrackByArtist,
  indexTrackByAlbum,
  indexTrackByArtistName,
  indexAlbumByArtist,
  indexAlbumByArtistName,
  setSavedTrackIds,
  addSavedTrack,
  removeSavedTrack,
  setSavedAlbumIds,
  addSavedAlbum,
  removeSavedAlbum,
  setFavoritedTrackIds,
  setFavoritedAlbumIds,
  addFavoritedTrack,
  removeFavoritedTrack,
  addFavoritedAlbum,
  removeFavoritedAlbum,
  setFollowedArtists,
  addFollowedArtist,
  removeFollowedArtist,
  setUserPlaylists,
  addUserPlaylist,
  removeUserPlaylist,
  setCurrentTrack,
  setQueue,
  nextTrack,
  prevTrack,
  togglePlay,
  setIsPlaying,
  updatePosition,
  setDuration,
  setVolume,
  toggleMute,
  setRepeat,
  toggleShuffle,
  addToQueue,
  removeFromQueue,
  setTrendingTrackIds,
  setTrendingAlbumIds,
  setRecentlyPlayedIds,
  addRecentlyPlayed,
  setNewReleaseIds,
  setUndergroundTrackIds,
  setRecommendedTrackIds,
  setExploreGenres,
  setExplorePopularTags,
  setActiveGenre,
  setActiveTag,
  setExploreResults,
  setExploreAlbumResults,
  setExploreSort,
  setExploreTab,
  setExploreLoading,
  setSearchQuery,
  setSearchResults,
  setSearchLoading,
  addDownloadedTrack,
  removeDownloadedTrack,
  setMusicView,
  setActiveDetailId,
  goBack,
  toggleQueuePanel,
  setViewMode,
} = musicSlice.actions;
