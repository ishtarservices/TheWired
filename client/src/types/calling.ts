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
  /** Capabilities the caller advertises. `e2ee: true` = the caller will
   *  frame-encrypt (docs/E2EE_CALLS.md). Missing = outdated caller; such
   *  invites are declined, never joined in plaintext. */
  caps?: CallCaps;
}

export interface CallCaps {
  e2ee?: boolean;
}

/** Why a call could not go ahead — shown as a toast (CallNotice). */
export type CallNoticeKind =
  /** The peer's client doesn't do encrypted calls (legacy invite, or it
   *  joined the room without encryption). */
  | "peer_outdated"
  /** This device's WebView lacks insertable streams / encoded transforms. */
  | "unsupported_device";

export interface CallNotice {
  kind: CallNoticeKind;
  /** The peer involved (for the "let them know" nudge). */
  pubkey: string;
  at: number;
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
  /** Frame-level E2EE is on for this call (always true for calls this build
   *  starts or answers; kept explicit so the UI never assumes). */
  e2ee: boolean;
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
  /** Their published tracks are end-to-end encrypted. `undefined` until a
   *  track is subscribed; `false` in an encrypted room = outdated client. */
  encrypted?: boolean;
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
