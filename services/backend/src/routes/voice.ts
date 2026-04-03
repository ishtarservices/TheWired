import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { livekitService } from "../services/livekitService.js";
import { permissionService } from "../services/permissionService.js";
import { channelService } from "../services/channelService.js";
import { db } from "../db/connection.js";
import { spaceMembers } from "../db/schema/members.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, and } from "drizzle-orm";
import { config } from "../config.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

const tokenBody = z.object({
  spaceId: nonEmptyString,
  channelId: nonEmptyString,
});

const kickBody = z.object({
  spaceId: nonEmptyString,
  channelId: nonEmptyString,
  targetPubkey: hexId,
});

const muteBody = z.object({
  spaceId: nonEmptyString,
  channelId: nonEmptyString,
  targetPubkey: hexId,
  trackSource: z.enum(["microphone", "camera"]),
});

const roomsParams = z.object({
  spaceId: nonEmptyString,
});

const dmTokenBody = z.object({
  partnerPubkey: hexId,
  roomId: nonEmptyString,
});

export const voiceRoutes: FastifyPluginAsync = async (server) => {
  /**
   * POST /token — Generate a LiveKit access token
   * Body: { spaceId, channelId }
   * Auth: NIP-98 via X-Auth-Pubkey
   */
  server.post<{
    Body: { spaceId: string; channelId: string };
  }>("/token", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(tokenBody, request.body, reply);
    if (!body) return;

    const { spaceId, channelId } = body;

    // Check membership
    const membership = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);

    if (membership.length === 0) {
      return reply.status(403).send({ error: "Not a member of this space", code: "FORBIDDEN" });
    }

    // Check if user is banned (bans deny everything)
    const banCheck = await permissionService.check(spaceId, pubkey, "JOIN_VOICE");
    if (banCheck.reason === "Banned") {
      return reply.status(403).send({ error: "Banned from this space", code: "FORBIDDEN" });
    }

    // Verify channel exists and is voice/video type
    const channels = await channelService.listChannels(spaceId);
    const channel = channels.find((c: any) => c.id === channelId);
    if (!channel) {
      return reply.status(404).send({ error: "Channel not found", code: "NOT_FOUND" });
    }
    if (channel.type !== "voice" && channel.type !== "video") {
      return reply.status(400).send({ error: "Channel is not a voice/video channel", code: "BAD_REQUEST" });
    }

    // Voice permissions default to allowed for members.
    // Fine-grained voice permissions (JOIN_VOICE, SPEAK, USE_VIDEO, SCREEN_SHARE)
    // are opt-out: allowed unless explicitly denied via role permissions.
    const canPublishSources: string[] = ["microphone", "camera", "screen_share", "screen_share_audio"];

    const roomName = `${spaceId}:${channelId}`;

    // Ensure room exists
    await livekitService.createRoom(roomName).catch(() => {
      // Room may already exist, that's fine
    });

    const token = await livekitService.generateToken(
      pubkey,
      roomName,
      pubkey, // Display name resolved on client side
      {
        canPublish: true,
        canPublishData: true,
        canSubscribe: true,
        canPublishSources,
      },
    );

    return {
      data: {
        token,
        url: livekitService.getClientUrl(),
        roomName,
      },
    };
  });

  /**
   * POST /kick — Remove a participant from a voice channel
   * Body: { spaceId, channelId, targetPubkey }
   */
  server.post<{
    Body: { spaceId: string; channelId: string; targetPubkey: string };
  }>("/kick", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(kickBody, request.body, reply);
    if (!body) return;

    const { spaceId, channelId, targetPubkey } = body;

    const perm = await permissionService.check(spaceId, pubkey, "MUTE_MEMBERS");
    if (!perm.allowed) {
      return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });
    }

    const roomName = `${spaceId}:${channelId}`;
    try {
      await livekitService.removeParticipant(roomName, targetPubkey);
      return { data: { success: true } };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
    }
  });

  /**
   * POST /mute — Server-mute a participant's track
   * Body: { spaceId, channelId, targetPubkey, trackSource }
   */
  server.post<{
    Body: {
      spaceId: string;
      channelId: string;
      targetPubkey: string;
      trackSource: "microphone" | "camera";
    };
  }>("/mute", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(muteBody, request.body, reply);
    if (!body) return;

    const { spaceId, channelId, targetPubkey, trackSource } = body;

    const perm = await permissionService.check(spaceId, pubkey, "MUTE_MEMBERS");
    if (!perm.allowed) {
      return reply.status(403).send({ error: "Missing MUTE_MEMBERS permission", code: "FORBIDDEN" });
    }

    const roomName = `${spaceId}:${channelId}`;
    try {
      // List participants to find the track SID
      const participants = await livekitService.listParticipants(roomName);
      const target = participants.find((p: any) => p.identity === targetPubkey);
      if (!target) {
        return reply.status(404).send({ error: "Participant not found in room", code: "NOT_FOUND" });
      }

      const track = target.tracks?.find((t: any) => t.source === trackSource);
      if (!track) {
        return reply.status(404).send({ error: `No ${trackSource} track found`, code: "NOT_FOUND" });
      }

      await livekitService.muteParticipant(roomName, targetPubkey, track.sid, true);
      return { data: { success: true } };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message, code: "BAD_REQUEST" });
    }
  });

  /**
   * GET /rooms/:spaceId — List active voice rooms in a space
   */
  server.get<{
    Params: { spaceId: string };
  }>("/rooms/:spaceId", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const params = validate(roomsParams, request.params, reply);
    if (!params) return;

    const { spaceId } = params;

    // Check membership
    const membership = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);

    if (membership.length === 0) {
      return reply.status(403).send({ error: "Not a member of this space", code: "FORBIDDEN" });
    }

    try {
      const rooms = await livekitService.listRooms();
      const spaceRooms = rooms.filter((r: any) => r.name?.startsWith(`${spaceId}:`));

      const result = await Promise.all(
        spaceRooms.map(async (room: any) => {
          const channelId = room.name.split(":")[1];
          const participants = await livekitService.listParticipants(room.name).catch(() => []);
          return {
            channelId,
            participantCount: room.numParticipants ?? participants.length,
            participants: (participants as any[]).map((p) => ({
              pubkey: p.identity,
              name: p.name,
            })),
          };
        }),
      );

      return { data: result };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: "INTERNAL_ERROR" });
    }
  });

  /**
   * POST /dm-token — Generate a LiveKit token for DM call SFU fallback
   * Body: { partnerPubkey, roomId }
   */
  server.post<{
    Body: { partnerPubkey: string; roomId: string };
  }>("/dm-token", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(dmTokenBody, request.body, reply);
    if (!body) return;

    const { roomId } = body;

    const roomName = `dm:${roomId}`;

    await livekitService.createRoom(roomName, 2).catch(() => {});

    const token = await livekitService.generateToken(
      pubkey,
      roomName,
      pubkey,
      {
        canPublish: true,
        canPublishData: true,
        canSubscribe: true,
        canPublishSources: ["microphone", "camera", "screen_share"],
      },
      3600, // 1 hour TTL for DM calls
    );

    return {
      data: {
        token,
        url: livekitService.getClientUrl(),
        roomName,
      },
    };
  });

  /**
   * POST /cleanup-temporary — Clean up temporary channels whose rooms are empty.
   * Called periodically or when a participant leaves.
   */
  server.post("/cleanup-temporary", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey || !config.adminPubkeys.includes(pubkey)) {
      return reply.status(403).send({ error: "Admin access required", code: "FORBIDDEN", statusCode: 403 });
    }

    try {
      // Find all temporary voice/video channels
      const tempChannels = await db
        .select()
        .from(spaceChannels)
        .where(eq(spaceChannels.temporary, true));

      if (tempChannels.length === 0) {
        return { data: { deleted: 0 } };
      }

      let deleted = 0;
      const activeRooms = await livekitService.listRooms().catch(() => []);
      const activeRoomNames = new Set((activeRooms as any[]).map((r) => r.name));

      for (const ch of tempChannels) {
        const roomName = `${ch.spaceId}:${ch.id}`;
        const room = activeRoomNames.has(roomName)
          ? activeRooms.find((r: any) => r.name === roomName)
          : null;

        // Delete if room doesn't exist or has 0 participants
        const participantCount = (room as any)?.numParticipants ?? 0;
        if (participantCount === 0) {
          await db.delete(spaceChannels).where(eq(spaceChannels.id, ch.id));
          deleted++;
        }
      }

      return { data: { deleted } };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message, code: "INTERNAL_ERROR" });
    }
  });
};
