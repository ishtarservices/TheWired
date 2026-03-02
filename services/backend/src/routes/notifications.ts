import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/connection.js";
import { notificationPreferences } from "../db/schema/notifications.js";
import { eq } from "drizzle-orm";

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
  server.put("/preferences", async (request) => {
    const pubkey = (request as any).pubkey;
    if (!pubkey) return { error: "Unauthorized", code: "UNAUTHORIZED", statusCode: 401 };

    const body = request.body as {
      enabled?: boolean;
      mentions?: boolean;
      dms?: boolean;
      newFollowers?: boolean;
      chatMessages?: boolean;
      mutedSpaces?: string[];
    };

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
