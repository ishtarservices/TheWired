import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { TrackSource } from "@livekit/protocol";
import { config } from "../config.js";

/** LiveKit HTTP API base URL (http, not ws) */
const livekitHttpUrl = config.livekitUrl.replace(/^ws/, "http");

const roomService = new RoomServiceClient(
  livekitHttpUrl,
  config.livekitApiKey,
  config.livekitApiSecret,
);

/** Map string source names to LiveKit TrackSource enum values */
const TRACK_SOURCE_MAP: Record<string, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

export interface TokenGrants {
  canPublish: boolean;
  canPublishData: boolean;
  canSubscribe: boolean;
  canPublishSources?: string[];
}

export const livekitService = {
  /**
   * Generate an access token for a participant to join a room.
   */
  async generateToken(
    identity: string,
    roomName: string,
    participantName: string,
    grants: TokenGrants,
    ttlSeconds = 86400,
  ): Promise<string> {
    const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity,
      name: participantName,
      ttl: ttlSeconds,
    });

    // Convert string source names to TrackSource enum values
    const sources = grants.canPublishSources
      ?.map((s) => TRACK_SOURCE_MAP[s])
      .filter((s): s is TrackSource => s !== undefined);

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: grants.canPublish,
      canPublishData: grants.canPublishData,
      canSubscribe: grants.canSubscribe,
      ...(sources && sources.length > 0 ? { canPublishSources: sources } : {}),
    });

    return await token.toJwt();
  },

  /** Create a room (or return existing) */
  async createRoom(roomName: string, maxParticipants?: number) {
    return roomService.createRoom({
      name: roomName,
      emptyTimeout: 300,
      maxParticipants: maxParticipants ?? 100,
    });
  },

  /** List all active rooms */
  async listRooms() {
    return roomService.listRooms();
  },

  /** List participants in a room */
  async listParticipants(roomName: string) {
    return roomService.listParticipants(roomName);
  },

  /** Remove a participant from a room */
  async removeParticipant(roomName: string, identity: string) {
    return roomService.removeParticipant(roomName, identity);
  },

  /** Mute a participant's published track */
  async muteParticipant(
    roomName: string,
    identity: string,
    trackSid: string,
    muted: boolean,
  ) {
    return roomService.mutePublishedTrack(roomName, identity, trackSid, muted);
  },

  /** Delete a room */
  async deleteRoom(roomName: string) {
    return roomService.deleteRoom(roomName);
  },

  /** Get the LiveKit WebSocket URL for client connections */
  getClientUrl(): string {
    return config.livekitUrl;
  },
};
