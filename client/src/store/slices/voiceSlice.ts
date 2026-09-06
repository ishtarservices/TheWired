import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  VoiceParticipant,
  ConnectedRoom,
  VoiceLocalState,
  VoiceLayoutState,
  LayoutMode,
  TileFit,
} from "../../types/calling";

const initialLayout = (): VoiceLayoutState => ({
  mode: "grid",
  focusedTileId: null,
  pinnedTileId: null,
  autoFocusSpeaker: false,
  fitOverrides: {},
});

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
  /** LiveKit transport state. "reconnecting" while the SDK re-establishes the
   *  signal/media connection after a network blip — the UI shows a banner
   *  instead of silently freezing. */
  connectionState: "connected" | "reconnecting";
  /** Last local media (mic/camera) failure, human-readable. Set when the
   *  microphone could not be enabled on join so the user knows they are
   *  silent instead of discovering it from the other side. */
  mediaError: string | null;
  /** Stage layout (grid / focus, pin, fit) for the connected room. */
  layout: VoiceLayoutState;
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
  connectionState: "connected",
  mediaError: null,
  layout: initialLayout(),
};

/** Drop layout references to tiles that no longer exist. */
function clearLayoutRefs(layout: VoiceLayoutState, isGone: (id: string) => boolean): void {
  if (layout.focusedTileId && isGone(layout.focusedTileId)) layout.focusedTileId = null;
  if (layout.pinnedTileId && isGone(layout.pinnedTileId)) layout.pinnedTileId = null;
  for (const id of Object.keys(layout.fitOverrides)) {
    if (isGone(id)) delete layout.fitOverrides[id];
  }
}

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
      state.connectionState = "connected";
      state.mediaError = null;
      // Keep the auto-focus preference across rooms; everything else is per-room.
      state.layout = { ...initialLayout(), autoFocusSpeaker: state.layout.autoFocusSpeaker };
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
      const prefix = `${action.payload}:`;
      clearLayoutRefs(state.layout, (id) => id.startsWith(prefix));
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
      state.localState.screenSharePending = false;
    },

    setScreenSharePending(state, action: PayloadAction<boolean>) {
      state.localState.screenSharePending = action.payload;
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

    setVoiceConnectionState(
      state,
      action: PayloadAction<"connected" | "reconnecting">,
    ) {
      state.connectionState = action.payload;
    },

    setMediaError(state, action: PayloadAction<string | null>) {
      state.mediaError = action.payload;
    },

    // ─── Stage layout ───────────────────────────────────────────
    setLayoutMode(state, action: PayloadAction<LayoutMode>) {
      state.layout.mode = action.payload;
      if (action.payload === "grid") state.layout.focusedTileId = null;
    },

    /** Enlarge a tile (null = back to grid). */
    focusTile(state, action: PayloadAction<string | null>) {
      state.layout.focusedTileId = action.payload;
      state.layout.mode = action.payload ? "focus" : "grid";
    },

    /** Pin a tile to the stage (null = unpin). Pinning enters focus mode. */
    pinTile(state, action: PayloadAction<string | null>) {
      state.layout.pinnedTileId = action.payload;
      if (action.payload) state.layout.mode = "focus";
    },

    toggleAutoFocusSpeaker(state) {
      state.layout.autoFocusSpeaker = !state.layout.autoFocusSpeaker;
      if (state.layout.autoFocusSpeaker) state.layout.mode = "focus";
    },

    setTileFit(state, action: PayloadAction<{ id: string; fit: TileFit }>) {
      if (action.payload.fit === "cover") delete state.layout.fitOverrides[action.payload.id];
      else state.layout.fitOverrides[action.payload.id] = action.payload.fit;
    },

    /** Called by the stage when tiles vanish (e.g. a screen share ends). */
    clearTileRefs(state, action: PayloadAction<string[]>) {
      const gone = new Set(action.payload);
      clearLayoutRefs(state.layout, (id) => gone.has(id));
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
  setScreenSharePending,
  toggleVideo,
  setVideoEnabled,
  setConnectionQuality,
  setRoomPresence,
  setAudioPlaybackBlocked,
  setVoiceConnectionState,
  setMediaError,
  setLayoutMode,
  focusTile,
  pinTile,
  toggleAutoFocusSpeaker,
  setTileFit,
  clearTileRefs,
} = voiceSlice.actions;
