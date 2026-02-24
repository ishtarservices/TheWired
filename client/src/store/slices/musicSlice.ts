import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MusicTrack, MusicAlbum, MusicPlaylist, MusicView, RepeatMode } from "../../types/music";

interface MusicState {
  tracks: Record<string, MusicTrack>;
  albums: Record<string, MusicAlbum>;
  playlists: Record<string, MusicPlaylist>;
  tracksByArtist: Record<string, string[]>;
  tracksByAlbum: Record<string, string[]>;

  library: {
    savedTrackIds: string[];
    savedAlbumIds: string[];
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
  };

  activeView: MusicView;
  activeDetailId: string | null;
  queueVisible: boolean;
  viewMode: "grid" | "list";
}

const initialState: MusicState = {
  tracks: {},
  albums: {},
  playlists: {},
  tracksByArtist: {},
  tracksByAlbum: {},

  library: {
    savedTrackIds: [],
    savedAlbumIds: [],
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
  },

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
      state.tracks[action.payload.addressableId] = action.payload;
    },
    addTracks(state, action: PayloadAction<MusicTrack[]>) {
      for (const t of action.payload) {
        state.tracks[t.addressableId] = t;
      }
    },
    addAlbum(state, action: PayloadAction<MusicAlbum>) {
      state.albums[action.payload.addressableId] = action.payload;
    },
    addAlbums(state, action: PayloadAction<MusicAlbum[]>) {
      for (const a of action.payload) {
        state.albums[a.addressableId] = a;
      }
    },
    addPlaylist(state, action: PayloadAction<MusicPlaylist>) {
      state.playlists[action.payload.addressableId] = action.payload;
    },
    addPlaylists(state, action: PayloadAction<MusicPlaylist[]>) {
      for (const p of action.payload) {
        state.playlists[p.addressableId] = p;
      }
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

    // ── Library ─────────────────────────────────────────────
    setSavedTrackIds(state, action: PayloadAction<string[]>) {
      state.library.savedTrackIds = action.payload;
    },
    addSavedTrack(state, action: PayloadAction<string>) {
      pushUnique(state.library.savedTrackIds, action.payload);
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
      pushUnique(state.library.savedAlbumIds, action.payload);
    },
    removeSavedAlbum(state, action: PayloadAction<string>) {
      state.library.savedAlbumIds = state.library.savedAlbumIds.filter(
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
      if (state.player.repeat === "one") {
        state.player.position = 0;
        return;
      }
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
        state.player.originalQueue = state.player.originalQueue.filter(
          (id) => id !== removedId,
        );
        if (idx < state.player.queueIndex) {
          state.player.queueIndex--;
        } else if (idx === state.player.queueIndex) {
          // Current track removed — play next
          if (state.player.queueIndex >= state.player.queue.length) {
            state.player.queueIndex = 0;
          }
          state.player.currentTrackId =
            state.player.queue[state.player.queueIndex] ?? null;
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

    // ── UI ──────────────────────────────────────────────────
    setMusicView(state, action: PayloadAction<MusicView>) {
      state.activeView = action.payload;
      state.activeDetailId = null;
    },
    setActiveDetailId(state, action: PayloadAction<{ view: MusicView; id: string }>) {
      state.activeView = action.payload.view;
      state.activeDetailId = action.payload.id;
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
  indexTrackByArtist,
  indexTrackByAlbum,
  setSavedTrackIds,
  addSavedTrack,
  removeSavedTrack,
  setSavedAlbumIds,
  addSavedAlbum,
  removeSavedAlbum,
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
  setMusicView,
  setActiveDetailId,
  toggleQueuePanel,
  setViewMode,
} = musicSlice.actions;
