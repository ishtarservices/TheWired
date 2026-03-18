import type { RootState } from "@/store";

/** Whether the user is currently connected to a voice channel */
export const selectIsInVoice = (s: RootState) => s.voice.connectedRoom !== null;

/** The connected room info */
export const selectConnectedRoom = (s: RootState) => s.voice.connectedRoom;

/** Whether currently connecting to a voice channel */
export const selectIsVoiceConnecting = (s: RootState) => s.voice.connecting;

/** Local user's voice state (muted, deafened, etc.) */
export const selectVoiceLocalState = (s: RootState) => s.voice.localState;

/** All participants in the current voice channel */
export const selectVoiceParticipants = (s: RootState) => s.voice.participants;

/** Participant count */
export const selectVoiceParticipantCount = (s: RootState) =>
  Object.keys(s.voice.participants).length;

/** Active speakers (pubkeys) */
export const selectActiveSpeakers = (s: RootState) => s.voice.activeSpeakers;

/** Connection quality */
export const selectVoiceConnectionQuality = (s: RootState) => s.voice.connectionQuality;

/** Whether the user is in a specific voice channel */
export const selectIsInChannel = (spaceId: string, channelId: string) => (s: RootState) =>
  s.voice.connectedRoom?.spaceId === spaceId && s.voice.connectedRoom?.channelId === channelId;

/** Active call state */
export const selectActiveCall = (s: RootState) => s.call.activeCall;

/** Incoming call invite */
export const selectIncomingCall = (s: RootState) => s.call.incomingCall;

/** Call history */
export const selectCallHistory = (s: RootState) => s.call.callHistory;

/** Whether there's an active call */
export const selectIsInCall = (s: RootState) => s.call.activeCall !== null;
