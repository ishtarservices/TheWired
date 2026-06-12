import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  VoiceParticipant,
  ConnectedRoom,
  VoiceLocalState,
} from "../../types/calling";

/** Presence info for a voice room (from API polling, visible to all space members) */
export interface RoomPresenceInfo {
  participantCount: number;
  participants: Array<{ pubkey: string; name: string }>;
}

interface VoiceState {
  /** Currently connected voice room (null if not in a room) */
  connectedRoom: ConnectedRoom | null;
  /** Participants in the current room keyed by pubkey */
  participants: Record<string, VoiceParticipant>;
  /** Local user state */
  localState: VoiceLocalState;
  /** Currently active speakers (pubkeys) */
  activeSpeakers: string[];
  /** Connection quality of local user */
  connectionQuality: "excellent" | "good" | "poor" | "unknown";
  /** Whether currently connecting to a room */
  connecting: boolean;
  /** Autoplay policy blocked audio playback — UI offers an "Enable audio"
   *  action that calls room.startAudio() from a user gesture. */
  audioPlaybackBlocked: boolean;
  /** LiveKit token for current room */
  token: string | null;
  /** LiveKit server URL */
  serverUrl: string | null;
  /** Room presence data from API (keyed by channelId, visible to all members) */
  roomPresence: Record<string, RoomPresenceInfo>;
}

const initialState: VoiceState = {
  connectedRoom: null,
  participants: {},
  localState: {
    muted: false,
    deafened: false,
    screenSharing: false,
    videoEnabled: false,
  },
  activeSpeakers: [],
  connectionQuality: "unknown",
  connecting: false,
  audioPlaybackBlocked: false,
  token: null,
  serverUrl: null,
  roomPresence: {},
};

export const voiceSlice = createSlice({
  name: "voice",
  initialState,
  reducers: {
    setConnecting(state, action: PayloadAction<boolean>) {
      state.connecting = action.payload;
    },

    setConnectedRoom(state, action: PayloadAction<{
      room: ConnectedRoom;
      token: string;
      serverUrl: string;
    }>) {
      state.connectedRoom = action.payload.room;
      state.token = action.payload.token;
      state.serverUrl = action.payload.serverUrl;
      state.connecting = false;
    },

    disconnectRoom(state) {
      state.connectedRoom = null;
      state.participants = {};
      state.activeSpeakers = [];
      state.connectionQuality = "unknown";
      state.connecting = false;
      state.audioPlaybackBlocked = false;
      state.token = null;
      state.serverUrl = null;
      state.localState = {
        muted: false,
        deafened: false,
        screenSharing: false,
        videoEnabled: false,
      };
    },

    addParticipant(state, action: PayloadAction<VoiceParticipant>) {
      state.participants[action.payload.pubkey] = action.payload;
    },

    removeParticipant(state, action: PayloadAction<string>) {
      delete state.participants[action.payload];
      state.activeSpeakers = state.activeSpeakers.filter(
        (pk) => pk !== action.payload,
      );
    },

    updateParticipant(
      state,
      action: PayloadAction<{ pubkey: string } & Partial<VoiceParticipant>>,
    ) {
      const { pubkey, ...updates } = action.payload;
      if (state.participants[pubkey]) {
        Object.assign(state.participants[pubkey], updates);
      }
    },

    setActiveSpeakers(state, action: PayloadAction<string[]>) {
      state.activeSpeakers = action.payload;
    },

    toggleMute(state) {
      state.localState.muted = !state.localState.muted;
      // Unmuting while deafened also un-deafens (Discord semantics) — the
      // user expects to be heard AND to hear again.
      if (!state.localState.muted && state.localState.deafened) {
        state.localState.deafened = false;
        state.localState.mutedBeforeDeafen = undefined;
      }
    },

    setMuted(state, action: PayloadAction<boolean>) {
      state.localState.muted = action.payload;
    },

    toggleDeafen(state) {
      if (!state.localState.deafened) {
        // Deafening also mutes, but remember what to restore (#8).
        state.localState.deafened = true;
        state.localState.mutedBeforeDeafen = state.localState.muted;
        state.localState.muted = true;
      } else {
        state.localState.deafened = false;
        state.localState.muted = state.localState.mutedBeforeDeafen ?? false;
        state.localState.mutedBeforeDeafen = undefined;
      }
    },

    toggleScreenShare(state) {
      state.localState.screenSharing = !state.localState.screenSharing;
    },

    setScreenSharing(state, action: PayloadAction<boolean>) {
      state.localState.screenSharing = action.payload;
    },

    toggleVideo(state) {
      state.localState.videoEnabled = !state.localState.videoEnabled;
    },

    setVideoEnabled(state, action: PayloadAction<boolean>) {
      state.localState.videoEnabled = action.payload;
    },

    setConnectionQuality(
      state,
      action: PayloadAction<"excellent" | "good" | "poor" | "unknown">,
    ) {
      state.connectionQuality = action.payload;
    },

    setRoomPresence(
      state,
      action: PayloadAction<Record<string, RoomPresenceInfo>>,
    ) {
      state.roomPresence = action.payload;
    },

    setAudioPlaybackBlocked(state, action: PayloadAction<boolean>) {
      state.audioPlaybackBlocked = action.payload;
    },
  },
});

export const {
  setConnecting,
  setConnectedRoom,
  disconnectRoom,
  addParticipant,
  removeParticipant,
  updateParticipant,
  setActiveSpeakers,
  toggleMute,
  setMuted,
  toggleDeafen,
  toggleScreenShare,
  setScreenSharing,
  toggleVideo,
  setVideoEnabled,
  setConnectionQuality,
  setRoomPresence,
  setAudioPlaybackBlocked,
} = voiceSlice.actions;
