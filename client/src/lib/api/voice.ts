import { api } from "./client";

export interface VoiceTokenResponse {
  token: string;
  url: string;
  roomName: string;
}

export interface VoiceRoomInfo {
  channelId: string;
  participantCount: number;
  participants: Array<{ pubkey: string; name: string }>;
}

/** Fetch a LiveKit token to join a voice channel */
export async function fetchVoiceToken(
  spaceId: string,
  channelId: string,
): Promise<VoiceTokenResponse> {
  const res = await api<VoiceTokenResponse>("/voice/token", {
    method: "POST",
    body: { spaceId, channelId },
  });
  return res.data;
}

/** Kick a participant from a voice channel */
export async function voiceKick(
  spaceId: string,
  channelId: string,
  targetPubkey: string,
): Promise<void> {
  await api("/voice/kick", {
    method: "POST",
    body: { spaceId, channelId, targetPubkey },
  });
}

/** Server-mute a participant's track */
export async function voiceMute(
  spaceId: string,
  channelId: string,
  targetPubkey: string,
  trackSource: "microphone" | "camera",
): Promise<void> {
  await api("/voice/mute", {
    method: "POST",
    body: { spaceId, channelId, targetPubkey, trackSource },
  });
}

/** List active voice rooms in a space */
export async function fetchVoiceRooms(
  spaceId: string,
): Promise<VoiceRoomInfo[]> {
  const res = await api<VoiceRoomInfo[]>(`/voice/rooms/${spaceId}`);
  return res.data;
}

/** Fetch a LiveKit token for DM call SFU fallback */
export async function fetchDMVoiceToken(
  partnerPubkey: string,
  roomId: string,
): Promise<VoiceTokenResponse> {
  const res = await api<VoiceTokenResponse>("/voice/dm-token", {
    method: "POST",
    body: { partnerPubkey, roomId },
  });
  return res.data;
}
