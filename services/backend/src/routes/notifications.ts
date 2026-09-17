import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/connection.js";
import { notificationPreferences, watchedBy } from "../db/schema/notifications.js";
import { eq } from "drizzle-orm";
import { validate, hexId } from "../lib/validation.js";

const spaceMode = z.enum(["all", "mentions", "nothing"]);

const MAX_WATCHED = 500;
const MAX_SPACE_MODES = 500;

const preferencesBody = z.object({
  enabled: z.boolean().optional(),
  mentions: z.boolean().optional(),
  dms: z.boolean().optional(),
  newFollowers: z.boolean().optional(),
  chatMessages: z.boolean().optional(),
  mutedSpaces: z.array(z.string()).optional(),
  replies: z.boolean().optional(),
  reactions: z.boolean().optional(),
  zaps: z.boolean().optional(),
  releases: z.boolean().optional(),
  friendRequests: z.boolean().optional(),
  spaceModes: z.record(z.string().min(1).max(128), spaceMode).optional(),
  watchedPubkeys: z.array(hexId).max(MAX_WATCHED).optional(),
  /** unix ms; null clears. */
  dndUntil: z.number().int().nonnegative().nullable().optional(),
});

export const DEFAULT_PREFERENCES = {
  enabled: true,
  mentions: true,
  dms: true,
  newFollowers: true,
  chatMessages: true,
  mutedSpaces: [] as string[],
  replies: true,
  reactions: true,
  zaps: true,
  releases: true,
  friendRequests: true,
  spaceModes: {} as Record<string, "all" | "mentions" | "nothing">,
  watchedPubkeys: [] as string[],
  dndUntil: null as number | null,
};

export const notificationsRoutes: FastifyPluginAsync = async (server) => {
  /** GET /notifications/preferences */
  server.get("/preferences", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.pubkey, pubkey))
      .limit(1);

    if (rows.length === 0) return { data: DEFAULT_PREFERENCES };

    const p = rows[0];
    return {
      data: {
        enabled: p.enabled,
        mentions: p.mentions,
        dms: p.dms,
        newFollowers: p.newFollowers,
        chatMessages: p.chatMessages,
        mutedSpaces: p.mutedSpaces ?? [],
        replies: p.replies,
        reactions: p.reactions,
        zaps: p.zaps,
        releases: p.releases,
        friendRequests: p.friendRequests,
        spaceModes: p.spaceModes ?? {},
        watchedPubkeys: p.watchedPubkeys ?? [],
        dndUntil: p.dndUntil ?? null,
      },
    };
  });

  /** PUT /notifications/preferences — partial upsert. `watchedPubkeys`
   *  rewrites the watched_by inverted index in the same transaction. */
  server.put("/preferences", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return reply.status(401).send({ error: "Unauthorized", code: "UNAUTHORIZED" });

    const body = validate(preferencesBody, request.body, reply);
    if (!body) return;
    if (body.spaceModes && Object.keys(body.spaceModes).length > MAX_SPACE_MODES) {
      return reply
        .status(400)
        .send({ error: "Validation error", details: [{ path: "spaceModes", message: "too many" }] });
    }

    const watched = body.watchedPubkeys ? [...new Set(body.watchedPubkeys)] : undefined;

    await db.transaction(async (tx) => {
      await tx
        .insert(notificationPreferences)
        .values({
          pubkey,
          enabled: body.enabled ?? true,
          mentions: body.mentions ?? true,
          dms: body.dms ?? true,
          newFollowers: body.newFollowers ?? true,
          chatMessages: body.chatMessages ?? true,
          mutedSpaces: body.mutedSpaces ?? [],
          replies: body.replies ?? true,
          reactions: body.reactions ?? true,
          zaps: body.zaps ?? true,
          releases: body.releases ?? true,
          friendRequests: body.friendRequests ?? true,
          spaceModes: body.spaceModes ?? {},
          watchedPubkeys: watched ?? [],
          dndUntil: body.dndUntil ?? null,
        })
        .onConflictDoUpdate({
          target: notificationPreferences.pubkey,
          set: {
            ...(body.enabled !== undefined && { enabled: body.enabled }),
            ...(body.mentions !== undefined && { mentions: body.mentions }),
            ...(body.dms !== undefined && { dms: body.dms }),
            ...(body.newFollowers !== undefined && { newFollowers: body.newFollowers }),
            ...(body.chatMessages !== undefined && { chatMessages: body.chatMessages }),
            ...(body.mutedSpaces !== undefined && { mutedSpaces: body.mutedSpaces }),
            ...(body.replies !== undefined && { replies: body.replies }),
            ...(body.reactions !== undefined && { reactions: body.reactions }),
            ...(body.zaps !== undefined && { zaps: body.zaps }),
            ...(body.releases !== undefined && { releases: body.releases }),
            ...(body.friendRequests !== undefined && { friendRequests: body.friendRequests }),
            ...(body.spaceModes !== undefined && { spaceModes: body.spaceModes }),
            ...(watched !== undefined && { watchedPubkeys: watched }),
            ...(body.dndUntil !== undefined && { dndUntil: body.dndUntil }),
            updatedAt: new Date(),
          },
        });

      if (watched !== undefined) {
        await tx.delete(watchedBy).where(eq(watchedBy.watcherPubkey, pubkey));
        if (watched.length > 0) {
          await tx
            .insert(watchedBy)
            .values(watched.map((authorPubkey) => ({ authorPubkey, watcherPubkey: pubkey })));
        }
      }
    });

    return { data: { success: true } };
  });
};
