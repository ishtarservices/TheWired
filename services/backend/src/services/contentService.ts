import { db } from "../db/connection.js";
import { pinnedMessages, scheduledMessages } from "../db/schema/content.js";
import { nanoid } from "../lib/id.js";

export const contentService = {
  async pinMessage(spaceId: string, channelId: string, eventId: string, pinnedBy: string) {
    await db.insert(pinnedMessages).values({
      id: nanoid(),
      spaceId,
      channelId,
      eventId,
      pinnedBy,
    });
  },

  async scheduleMessage(
    spaceId: string,
    channelId: string,
    content: string,
    scheduledAt: number,
    scheduledBy: string,
    kind?: number,
  ) {
    await db.insert(scheduledMessages).values({
      id: nanoid(),
      spaceId,
      channelId,
      content,
      kind: kind ?? 9,
      scheduledBy,
      scheduledAt,
    });
  },
};
