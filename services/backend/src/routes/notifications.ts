import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/connection.js";
import { notificationPreferences } from "../db/schema/notifications.js";
import { eq } from "drizzle-orm";
import { validate } from "../lib/validation.js";

const preferencesBody = z.object({
  enabled: z.boolean().optional(),
  mentions: z.boolean().optional(),
  dms: z.boolean().optional(),
  newFollowers: z.boolean().optional(),
  chatMessages: z.boolean().optional(),
  mutedSpaces: z.array(z.string()).optional(),
});

export const notificationsRoutes: FastifyPluginAsync = async (server) => {
  /** GET /notifications/preferences */
  server.get("/preferences", async (request) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const rows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.pubkey, pubkey))
      .limit(1);

    if (rows.length === 0) {
      return {
        data: {
          enabled: true,
          mentions: true,
          dms: true,
          newFollowers: true,
          chatMessages: true,
          mutedSpaces: [],
        },
      };
    }

    const p = rows[0];
    return {
      data: {
        enabled: p.enabled,
        mentions: p.mentions,
        dms: p.dms,
        newFollowers: p.newFollowers,
        chatMessages: p.chatMessages,
        mutedSpaces: p.mutedSpaces ?? [],
      },
    };
  });

  /** PUT /notifications/preferences */
  server.put("/preferences", async (request, reply) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const body = validate(preferencesBody, request.body, reply);
    if (!body) return;

    await db
      .insert(notificationPreferences)
      .values({
        pubkey,
        enabled: body.enabled ?? true,
        mentions: body.mentions ?? true,
        dms: body.dms ?? true,
        newFollowers: body.newFollowers ?? true,
        chatMessages: body.chatMessages ?? true,
        mutedSpaces: body.mutedSpaces ?? [],
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
          updatedAt: new Date(),
        },
      });

    return { data: { success: true } };
  });
};
