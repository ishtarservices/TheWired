/** Call state machine states */
export type CallState = "idle" | "ringing" | "connecting" | "active" | "ended";

/** Type of call */
export type CallType = "audio" | "video";

/** How a 1:1 call's media is carried. Desktop is SFU-only (LiveKit room
 *  `dm:<roomId>`); the field lets a peer detect an incompatible caller. */
export type CallTransport = "sfu" | "p2p";

/** Incoming call invitation (received via NIP-17 gift wrap) */
export interface CallInvite {
  callerPubkey: string;
  roomSecretKey: string;
  callType: CallType;
  callerName: string;
  timestamp: number;
  /** Missing on invites from older clients (which expected P2P signaling). */
  transport?: CallTransport;
}

/** How the active-call panel is shown. */
export type CallPanelMode = "floating" | "expanded" | "minimized";

/** Corner the local picture-in-picture snaps to. */
export type PipCorner = "tl" | "tr" | "bl" | "br";

/** Active call state */
export interface ActiveCall {
  partnerPubkey: string;
  callType: CallType;
  direction: "incoming" | "outgoing";
  roomId: string;
  roomSecretKey: string;
  state: CallState;
  /** When the invite went out / was accepted (ringing starts here). */
  startedAt: number;
  /** When media first came up (state → "active"). Timer + duration source. */
  connectedAt?: number;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  /** The OS share picker is open — not live yet. */
  isScreenSharePending?: boolean;
}

/** What a media tile shows: a participant's camera or their screen share. */
export type TileSource = "camera" | "screenshare";

/** How video fills a tile. Screen shares are always "contain". */
export type TileFit = "cover" | "contain";

export type LayoutMode = "grid" | "focus";

/** Stage layout state for a voice/video room (voiceSlice.layout). */
export interface VoiceLayoutState {
  mode: LayoutMode;
  /** Tile explicitly enlarged (double-click); cleared when it leaves. */
  focusedTileId: string | null;
  /** Tile pinned to the stage; beats focus and auto-speaker. */
  pinnedTileId: string | null;
  /** In focus mode with nothing pinned, follow the (debounced) active speaker. */
  autoFocusSpeaker: boolean;
  /** Per-tile cover/contain override. */
  fitOverrides: Record<string, TileFit>;
}

/** Voice channel participant */
export interface VoiceParticipant {
  pubkey: string;
  displayName: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  hasVideo: boolean;
  isScreenSharing: boolean;
  connectionQuality: "excellent" | "good" | "poor" | "unknown";
  handRaised: boolean;
  audioLevel: number;
}

/** Voice channel configuration */
export interface VoiceChannelConfig {
  maxParticipants?: number;
  bitrate?: number;
  region?: string;
}

/** Connected voice room state */
export interface ConnectedRoom {
  spaceId: string;
  channelId: string;
  roomName: string;
}

/** Voice channel local state */
export interface VoiceLocalState {
  muted: boolean;
  deafened: boolean;
  /** Mute state before deafening, restored on un-deafen. */
  mutedBeforeDeafen?: boolean;
  screenSharing: boolean;
  /** The OS share picker is open (getDisplayMedia pending) — not live yet. */
  screenSharePending?: boolean;
  videoEnabled: boolean;
}

/** Room presence event (kind:10312) */
export interface RoomPresence {
  pubkey: string;
  roomRef: string;
  handRaised: boolean;
  muted: boolean;
  createdAt: number;
}

/** Live chat message in voice room (kind:1311) */
export interface LiveChatMessage {
  id: string;
  pubkey: string;
  content: string;
  roomRef: string;
  createdAt: number;
}

/** Voice permissions */
export type VoicePermission =
  | "JOIN_VOICE"
  | "SPEAK"
  | "USE_VIDEO"
  | "SCREEN_SHARE"
  | "PRIORITY_SPEAKER"
  | "MUTE_MEMBERS"
  | "MOVE_MEMBERS"
  | "MANAGE_VOICE"
  | "START_RECORDING"
  | "START_STREAM";
