import { db } from "../db/connection.js";
import { notificationQueue } from "../db/schema/notifications.js";
import { notificationPreferences } from "../db/schema/notifications.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

interface EnqueueParams {
  pubkey: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Enqueue a push notification for a user.
 * Checks their server-side preferences before inserting.
 */
export async function enqueueNotification({
  pubkey,
  type,
  title,
  body,
  data,
}: EnqueueParams): Promise<void> {
  try {
    // Check user preferences
    const prefs = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.pubkey, pubkey))
      .limit(1);

    if (prefs.length > 0) {
      const p = prefs[0];
      if (!p.enabled) return;

      // Check type-specific preferences
      if (type === "mention" && !p.mentions) return;
      if (type === "dm" && !p.dms) return;
      if (type === "follow" && !p.newFollowers) return;
      if (type === "chat" && !p.chatMessages) return;

      // Check muted spaces
      if (data?.spaceId && p.mutedSpaces) {
        const mutedSpaces = p.mutedSpaces as string[];
        if (mutedSpaces.includes(data.spaceId as string)) return;
      }
    }

    await db.insert(notificationQueue).values({
      id: randomUUID(),
      pubkey,
      type,
      title,
      body,
      data: data ? JSON.stringify(data) : null,
    });
  } catch (err) {
    console.error("[notificationEnqueue] Failed to enqueue:", err);
  }
}
