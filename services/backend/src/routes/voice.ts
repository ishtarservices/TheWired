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
import { getRedis } from "../lib/redis.js";
import { validate, hexId, nonEmptyString } from "../lib/validation.js";

/** How long a `dm:<roomId>` stays bound to its two parties (≥ the token TTL). */
const DM_ROOM_BINDING_TTL_S = 3600;

/**
 * Bind a 1:1 call room to the two pubkeys of the first mint, and reject any
 * third party afterwards. The roomId is only a pubkey the caller chose, so
 * without this anyone who learns it could mint a token for the room (and,
 * with `maxParticipants: 2`, take the callee's seat — a DoS; under E2EE they
 * would only ever receive ciphertext). Returns false when `pubkey` is not one
 * of the bound pair. Redis failures fail OPEN (the E2EE layer is the real
 * confidentiality guard; this is hygiene).
 */
async function bindDmRoom(roomId: string, pubkey: string, partnerPubkey: string): Promise<boolean> {
  const key = `voice:dm:${roomId}`;
  const pair = [pubkey, partnerPubkey].sort().join(",");
  try {
    const redis = getRedis();
    const created = await redis.set(key, pair, "EX", DM_ROOM_BINDING_TTL_S, "NX");
    if (created === "OK") return true;
    const existing = await redis.get(key);
    if (existing === null) return true;
    return existing.split(",").includes(pubkey);
  } catch (err) {
    console.warn("[voice] dm room binding unavailable:", err);
    return true;
  }
}

const tokenBody = z.object({
  spaceId: nonEmptyString,
  channelId: nonEmptyString,
  /** The client will frame-encrypt in the room (docs/E2EE_CALLS.md). */
  supportsE2EE: z.boolean().optional(),
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
  supportsE2EE: z.boolean().optional(),
});

/** Rooms are E2EE-only: a client that can't encrypt must not get a token. */
function e2eeRequiredError() {
  return {
    error: "Voice and video are end-to-end encrypted. Update The Wired to join.",
    code: "E2EE_REQUIRED",
    statusCode: 409,
  };
}

export const voiceRoutes: FastifyPluginAsync = async (server) => {
  /**
   * POST /token — Generate a LiveKit access token
   * Body: { spaceId, channelId }
   * Auth: NIP-98 via X-Auth-Pubkey
   */
  server.post<{
    Body: { spaceId: string; channelId: string; supportsE2EE?: boolean };
  }>("/token", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(tokenBody, request.body, reply);
    if (!body) return;

    const { spaceId, channelId } = body;
    if (config.voiceRequireE2EE && body.supportsE2EE !== true) {
      return reply.status(409).send(e2eeRequiredError());
    }

    // Check membership
    const membership = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)))
      .limit(1);

    if (membership.length === 0) {
      return reply.status(403).send({ error: "Not a member of this space", code: "FORBIDDEN" });
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

    // Closes #75. Gate entry on the channel-scoped CONNECT permission (this also
    // folds in the ban check — bans deny everything inside permissionService).
    // The real permission is CONNECT, not the non-existent "JOIN_VOICE".
    const connect = await permissionService.check(spaceId, pubkey, "CONNECT", channelId);
    if (!connect.allowed) {
      return reply.status(403).send({ error: connect.reason ?? "Cannot connect to this channel", code: "FORBIDDEN" });
    }

    // Compute publish grants from effective (channel-scoped) permissions. The base
    // role model is an allow-list, so a source is granted only when the permission
    // is actually held and not channel-denied. The default Member role grants all
    // of SPEAK/VIDEO/SCREEN_SHARE and admins bypass, so ordinary members are
    // unaffected; only role-restricted / channel-denied users are downgraded
    // (e.g. listen-only). SCREEN_SHARE maps to two LiveKit sources.
    const [speak, video, screen] = await Promise.all([
      permissionService.check(spaceId, pubkey, "SPEAK", channelId),
      permissionService.check(spaceId, pubkey, "VIDEO", channelId),
      permissionService.check(spaceId, pubkey, "SCREEN_SHARE", channelId),
    ]);
    const canPublishSources: string[] = [];
    if (speak.allowed) canPublishSources.push("microphone");
    if (video.allowed) canPublishSources.push("camera");
    if (screen.allowed) canPublishSources.push("screen_share", "screen_share_audio");
    const canPublish = canPublishSources.length > 0;

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
        canPublish,
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
    Body: { partnerPubkey: string; roomId: string; supportsE2EE?: boolean };
  }>("/dm-token", async (request, reply) => {
    const pubkey = (request as any).pubkey as string | undefined;
    if (!pubkey) {
      return reply.status(401).send({ error: "Authentication required", code: "UNAUTHORIZED" });
    }

    const body = validate(dmTokenBody, request.body, reply);
    if (!body) return;

    const { roomId, partnerPubkey } = body;

    if (partnerPubkey === pubkey) {
      return reply.status(400).send({ error: "Cannot call yourself", code: "BAD_REQUEST" });
    }
    if (config.voiceRequireE2EE && body.supportsE2EE !== true) {
      return reply.status(409).send(e2eeRequiredError());
    }
    if (!(await bindDmRoom(roomId, pubkey, partnerPubkey))) {
      return reply.status(403).send({ error: "Not a party to this call", code: "FORBIDDEN" });
    }

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
        // screen_share_audio: Windows (WebView2) captures system audio with
        // the share; without the grant LiveKit rejects the audio track.
        canPublishSources: ["microphone", "camera", "screen_share", "screen_share_audio"],
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
