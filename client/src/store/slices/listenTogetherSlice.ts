import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ImetaVariant } from "@/types/media";

export interface ListenTogetherReaction {
  pubkey: string;
  emoji: string;
  ts: number;
}

/** A listener's track suggestion, waiting in the DJ's inbox. */
export interface ListenTogetherSuggestion {
  trackId: string;
  trackMeta: {
    title: string;
    artist: string;
    imageUrl?: string;
    variants: ImetaVariant[];
    visibility?: "public" | "space" | "private";
  };
  /** Suggester (the sender's participant identity). */
  from: string;
  ts: number;
}

/** Oldest suggestions fall off past this. */
const MAX_SUGGESTIONS = 20;

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
  /**
   * DJ whose session was dismissed or left. DJs re-send lt:start to catch up
   * late joiners; one from this DJ is the same session and stays quiet. Cleared
   * by that DJ's lt:end or departure, so their next session invites again.
   */
  dismissedDJ: string | null;
  /** Track suggestions from listeners (DJ only; cleared on DJ change). */
  suggestions: ListenTogetherSuggestion[];
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
  dismissedDJ: null,
  suggestions: [],
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
      state.dismissedDJ = null;
      state.suggestions = [];
    },

    endSession() {
      return initialState;
    },

    /** Leaves `dismissed` alone — callers decide whether this is a new session. */
    setPendingInvite(state, action: PayloadAction<PendingInvite>) {
      state.pendingInvite = action.payload;
    },

    updatePendingInvite(
      state,
      action: PayloadAction<Partial<Pick<PendingInvite, "trackId" | "trackMeta" | "position" | "isPlaying" | "queue" | "queueIndex" | "ts">>>,
    ) {
      if (state.pendingInvite) {
        Object.assign(state.pendingInvite, action.payload);
      }
    },

    /**
     * The inviting DJ handed off before we joined: the invite (and a dismissal
     * of it) now belongs to the new DJ.
     */
    retargetPendingSession(state, action: PayloadAction<string>) {
      if (state.pendingInvite) state.pendingInvite.djPubkey = action.payload;
      if (state.dismissedDJ) state.dismissedDJ = action.payload;
    },

    clearPendingInvite(state) {
      state.pendingInvite = null;
    },

    setDismissed(state, action: PayloadAction<boolean>) {
      state.dismissed = action.payload;
      if (!action.payload) state.dismissedDJ = null;
    },

    /** Hide the invite for `djPubkey`'s current session (dismiss or leave). */
    dismissSession(state, action: PayloadAction<string | null>) {
      state.dismissed = true;
      state.dismissedDJ = action.payload;
    },

    setDJ(state, action: PayloadAction<{ pubkey: string; isLocal: boolean }>) {
      state.djPubkey = action.payload.pubkey;
      state.isLocalDJ = action.payload.isLocal;
      state.skipVotes = [];
      state.suggestions = [];
    },

    /** Newest first; a re-suggested track moves to the top. */
    addSuggestion(state, action: PayloadAction<ListenTogetherSuggestion>) {
      const rest = state.suggestions.filter((s) => s.trackId !== action.payload.trackId);
      state.suggestions = [action.payload, ...rest].slice(0, MAX_SUGGESTIONS);
    },

    removeSuggestion(state, action: PayloadAction<string>) {
      state.suggestions = state.suggestions.filter((s) => s.trackId !== action.payload);
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

    removeSkipVote(state, action: PayloadAction<string>) {
      state.skipVotes = state.skipVotes.filter((p) => p !== action.payload);
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
  retargetPendingSession,
  setDismissed,
  dismissSession,
  addSuggestion,
  removeSuggestion,
  setDJ,
  setSharedQueue,
  setCurrentTrack: setLTCurrentTrack,
  setIsPlaying: setLTIsPlaying,
  setPosition: setLTPosition,
  addListener,
  removeListener,
  addSkipVote,
  removeSkipVote,
  clearSkipVotes,
  addReaction,
  pruneReactions,
  setPickerOpen,
} = listenTogetherSlice.actions;
