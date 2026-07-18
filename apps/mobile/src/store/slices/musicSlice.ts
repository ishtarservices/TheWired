// ─── Music catalog + player mirror ────────────────────────────────────
// react-native-track-player owns playback and the queue in its native layer;
// this slice holds (a) the parsed MusicItem catalog keyed by addressableId and
// (b) a UI MIRROR of RNTP's playback state (current track, status, queue order)
// updated from the RNTP Event.* bridge in lib/music/playerService.ts. Live
// position is NOT here — MiniPlayer/NowPlaying read it via RNTP useProgress().
// The queue authority is RNTP; queueIds/originalOrder here exist only to render
// the Now Playing list and to compute shuffle order.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { MusicItem } from "@/screens/spaces/musicEventParser";

export type MusicStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type MusicRepeat = "off" | "track" | "queue";

interface PlayerMirror {
  /** addressableId of RNTP's active track, or null when nothing is loaded. */
  currentId: string | null;
  /** Mirror of RNTP's queue order (addressableIds) for the Now Playing list. */
  queueIds: string[];
  /** Pre-shuffle order, so un-shuffle restores the original sequence. */
  originalOrder: string[];
  status: MusicStatus;
  /** Active track duration (seconds), from the RNTP active-track event. */
  durationSec: number;
  repeat: MusicRepeat;
  shuffle: boolean;
  error: string | null;
}

interface MusicState {
  /** Parsed catalog keyed by addressableId (`${kind}:${pubkey}:${d}`). */
  itemsById: Record<string, MusicItem>;
  player: PlayerMirror;
}

const initialPlayer: PlayerMirror = {
  currentId: null,
  queueIds: [],
  originalOrder: [],
  status: "idle",
  durationSec: 0,
  repeat: "off",
  shuffle: false,
  error: null,
};

const initialState: MusicState = { itemsById: {}, player: initialPlayer };

/** Fisher–Yates shuffle keeping `currentId` pinned first (so the playing track
 *  doesn't jump). `rand` is injectable for deterministic tests. Pure. */
export function shuffleOrder(
  ids: string[],
  currentId: string | null,
  rand: () => number = Math.random,
): string[] {
  const rest = ids.filter((id) => id !== currentId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return currentId != null && ids.includes(currentId) ? [currentId, ...rest] : rest;
}

export const musicSlice = createSlice({
  name: "music",
  initialState,
  reducers: {
    /** Merge parsed items into the catalog, newest-wins by created_at (an
     *  addressable replace shouldn't be clobbered by a stale earlier version). */
    itemsUpserted(state, action: PayloadAction<MusicItem[]>) {
      for (const item of action.payload) {
        const prev = state.itemsById[item.addressableId];
        if (!prev || item.event.created_at >= prev.event.created_at) {
          state.itemsById[item.addressableId] = item;
        }
      }
    },

    /** A new queue was loaded into RNTP — establish the mirror + optimistic
     *  current track (RNTP's active-track event will confirm it). */
    queueLoaded(
      state,
      action: PayloadAction<{ queueIds: string[]; currentId: string | null }>,
    ) {
      const { queueIds, currentId } = action.payload;
      state.player.queueIds = queueIds;
      state.player.originalOrder = queueIds;
      state.player.currentId = currentId;
      state.player.status = "loading";
      state.player.shuffle = false;
      state.player.error = null;
    },

    /** RNTP Event.PlaybackActiveTrackChanged — the authoritative current track. */
    mirrorTrackChanged(
      state,
      action: PayloadAction<{ currentId: string | null; durationSec?: number }>,
    ) {
      state.player.currentId = action.payload.currentId;
      if (action.payload.durationSec !== undefined) {
        state.player.durationSec = action.payload.durationSec;
      }
      if (state.player.error) state.player.error = null;
    },

    /** RNTP Event.PlaybackState → our coarse status. */
    mirrorStatusChanged(state, action: PayloadAction<MusicStatus>) {
      state.player.status = action.payload;
    },

    /** RNTP Event.PlaybackQueueEnded / stop. */
    playbackEnded(state) {
      state.player.status = "idle";
    },

    playerErrored(state, action: PayloadAction<string>) {
      state.player.status = "error";
      state.player.error = action.payload;
    },

    repeatSet(state, action: PayloadAction<MusicRepeat>) {
      state.player.repeat = action.payload;
    },

    /** Shuffle toggled — the thunk computed the new order + rebuilt RNTP's
     *  queue; store the resulting order + flag (originalOrder is preserved). */
    shuffleApplied(
      state,
      action: PayloadAction<{ queueIds: string[]; shuffle: boolean }>,
    ) {
      state.player.queueIds = action.payload.queueIds;
      state.player.shuffle = action.payload.shuffle;
    },

    /** Logout / account switch (native stop is playerService's job). */
    musicCleared() {
      return initialState;
    },
  },
});

export const {
  itemsUpserted,
  queueLoaded,
  mirrorTrackChanged,
  mirrorStatusChanged,
  playbackEnded,
  playerErrored,
  repeatSet,
  shuffleApplied,
  musicCleared,
} = musicSlice.actions;

// ─── Selectors (structurally typed to avoid the store/index.ts cycle) ──

interface WithMusic {
  music: MusicState;
}

const EMPTY_IDS: string[] = [];

export function selectMusicItem(state: WithMusic, id: string): MusicItem | undefined {
  return state.music.itemsById[id];
}

export function selectCurrentItem(state: WithMusic): MusicItem | null {
  const id = state.music.player.currentId;
  return id ? (state.music.itemsById[id] ?? null) : null;
}

export function selectCurrentId(state: WithMusic): string | null {
  return state.music.player.currentId;
}

export function selectPlayerStatus(state: WithMusic): MusicStatus {
  return state.music.player.status;
}

export function selectQueueIds(state: WithMusic): string[] {
  return state.music.player.queueIds.length ? state.music.player.queueIds : EMPTY_IDS;
}

export function selectIsCurrent(state: WithMusic, id: string): boolean {
  return state.music.player.currentId === id;
}

export function selectPlayer(state: WithMusic): PlayerMirror {
  return state.music.player;
}
