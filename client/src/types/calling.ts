/** Call state machine states */
export type CallState = "idle" | "ringing" | "connecting" | "active" | "ended";

/** Type of call */
export type CallType = "audio" | "video";

/** Incoming call invitation (received via NIP-17 gift wrap) */
export interface CallInvite {
  callerPubkey: string;
  roomSecretKey: string;
  callType: CallType;
  callerName: string;
  timestamp: number;
}

/** Active call state */
export interface ActiveCall {
  partnerPubkey: string;
  callType: CallType;
  roomId: string;
  roomSecretKey: string;
  state: CallState;
  startedAt: number;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  /** Whether this is an SFU-assisted call (P2P failed) */
  isSfuFallback: boolean;
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
  screenSharing: boolean;
  videoEnabled: boolean;
}

/** NIP-RTC signaling message types */
export type RTCSignalType = "connect" | "disconnect" | "offer" | "answer" | "candidate";

/** NIP-RTC signaling message payload */
export interface RTCSignalPayload {
  type: RTCSignalType;
  roomId: string;
  senderPubkey: string;
  recipientPubkey?: string;
  data?: {
    offer?: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    candidates?: RTCIceCandidateInit[];
    turn?: string[];
  };
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
