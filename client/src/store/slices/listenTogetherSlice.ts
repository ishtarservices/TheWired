import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ImetaVariant } from "@/types/media";

export interface ListenTogetherReaction {
  pubkey: string;
  emoji: string;
  ts: number;
}

/** Stored when a remote DJ starts a session — shown as an invite until accepted */
export interface PendingInvite {
  djPubkey: string;
  context: "space" | "dm";
  roomId: string;
  trackId: string | null;
  trackMeta: {
    title: string;
    artist: string;
    imageUrl?: string;
    variants: ImetaVariant[];
  } | null;
  queue: string[];
  queueIndex: number;
  position: number;
  isPlaying: boolean;
  ts: number;
}

export interface ListenTogetherState {
  active: boolean;
  context: "space" | "dm" | null;
  roomId: string | null;
  djPubkey: string | null;
  isLocalDJ: boolean;
  sharedQueue: string[]; // track addressableIds
  sharedQueueIndex: number;
  currentTrackId: string | null;
  isPlaying: boolean;
  position: number;
  listeners: string[]; // pubkeys
  skipVotes: string[];
  reactions: ListenTogetherReaction[];
  pickerOpen: boolean;
  /** Invite waiting for user to accept/dismiss (non-DJ only) */
  pendingInvite: PendingInvite | null;
  /** User dismissed the invite for this session — hide banner but keep metadata */
  dismissed: boolean;
}

const initialState: ListenTogetherState = {
  active: false,
  context: null,
  roomId: null,
  djPubkey: null,
  isLocalDJ: false,
  sharedQueue: [],
  sharedQueueIndex: 0,
  currentTrackId: null,
  isPlaying: false,
  position: 0,
  listeners: [],
  skipVotes: [],
  reactions: [],
  pickerOpen: false,
  pendingInvite: null,
  dismissed: false,
};

export const listenTogetherSlice = createSlice({
  name: "listenTogether",
  initialState,
  reducers: {
    startSession(
      state,
      action: PayloadAction<{
        context: "space" | "dm";
        roomId: string;
        djPubkey: string;
        isLocalDJ: boolean;
      }>,
    ) {
      const { context, roomId, djPubkey, isLocalDJ } = action.payload;
      state.active = true;
      state.context = context;
      state.roomId = roomId;
      state.djPubkey = djPubkey;
      state.isLocalDJ = isLocalDJ;
      state.listeners = [djPubkey];
      state.skipVotes = [];
      state.reactions = [];
      state.pendingInvite = null;
      state.dismissed = false;
    },

    endSession() {
      return initialState;
    },

    setPendingInvite(state, action: PayloadAction<PendingInvite>) {
      state.pendingInvite = action.payload;
      state.dismissed = false;
    },

    updatePendingInvite(
      state,
      action: PayloadAction<Partial<Pick<PendingInvite, "trackId" | "trackMeta" | "position" | "isPlaying" | "queue" | "queueIndex" | "ts">>>,
    ) {
      if (state.pendingInvite) {
        Object.assign(state.pendingInvite, action.payload);
      }
    },

    clearPendingInvite(state) {
      state.pendingInvite = null;
    },

    setDismissed(state, action: PayloadAction<boolean>) {
      state.dismissed = action.payload;
    },

    setDJ(state, action: PayloadAction<{ pubkey: string; isLocal: boolean }>) {
      state.djPubkey = action.payload.pubkey;
      state.isLocalDJ = action.payload.isLocal;
      state.skipVotes = [];
    },

    setSharedQueue(
      state,
      action: PayloadAction<{ queue: string[]; queueIndex: number }>,
    ) {
      state.sharedQueue = action.payload.queue;
      state.sharedQueueIndex = action.payload.queueIndex;
    },

    setCurrentTrack(
      state,
      action: PayloadAction<{
        trackId: string | null;
        isPlaying: boolean;
        position: number;
      }>,
    ) {
      state.currentTrackId = action.payload.trackId;
      state.isPlaying = action.payload.isPlaying;
      state.position = action.payload.position;
    },

    setIsPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },

    setPosition(state, action: PayloadAction<number>) {
      state.position = action.payload;
    },

    addListener(state, action: PayloadAction<string>) {
      if (!state.listeners.includes(action.payload)) {
        state.listeners.push(action.payload);
      }
    },

    removeListener(state, action: PayloadAction<string>) {
      state.listeners = state.listeners.filter((p) => p !== action.payload);
    },

    addSkipVote(state, action: PayloadAction<string>) {
      if (!state.skipVotes.includes(action.payload)) {
        state.skipVotes.push(action.payload);
      }
    },

    clearSkipVotes(state) {
      state.skipVotes = [];
    },

    addReaction(state, action: PayloadAction<ListenTogetherReaction>) {
      state.reactions.push(action.payload);
      // Keep only last 30 reactions
      if (state.reactions.length > 30) {
        state.reactions = state.reactions.slice(-30);
      }
    },

    pruneReactions(state, action: PayloadAction<number>) {
      const cutoff = action.payload;
      state.reactions = state.reactions.filter((r) => r.ts > cutoff);
    },

    setPickerOpen(state, action: PayloadAction<boolean>) {
      state.pickerOpen = action.payload;
    },
  },
});

export const {
  startSession,
  endSession,
  setPendingInvite,
  updatePendingInvite,
  clearPendingInvite,
  setDismissed,
  setDJ,
  setSharedQueue,
  setCurrentTrack: setLTCurrentTrack,
  setIsPlaying: setLTIsPlaying,
  setPosition: setLTPosition,
  addListener,
  removeListener,
  addSkipVote,
  clearSkipVotes,
  addReaction,
  pruneReactions,
  setPickerOpen,
} = listenTogetherSlice.actions;
