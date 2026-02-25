import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, and, asc } from "drizzle-orm";

/** Feed types that allow only one channel per space */
const UNIQUE_FEED_TYPES = new Set(["notes", "media", "articles", "music"]);

interface CreateChannelParams {
  type: string;
  label: string;
  adminOnly?: boolean;
  slowModeSeconds?: number;
}

interface UpdateChannelParams {
  label?: string;
  position?: number;
  adminOnly?: boolean;
  slowModeSeconds?: number;
}

const DEFAULT_CHANNELS: Array<{ type: string; label: string; position: number }> = [
  { type: "chat", label: "#chat", position: 0 },
  { type: "notes", label: "#notes", position: 1 },
  { type: "media", label: "#media", position: 2 },
  { type: "articles", label: "#articles", position: 3 },
  { type: "music", label: "#music", position: 4 },
];

export const channelService = {
  /** List channels for a space, auto-seeding defaults if empty */
  async listChannels(spaceId: string) {
    let channels = await db
      .select()
      .from(spaceChannels)
      .where(eq(spaceChannels.spaceId, spaceId))
      .orderBy(asc(spaceChannels.position));

    if (channels.length === 0) {
      await this.seedDefaultChannels(spaceId);
      channels = await db
        .select()
        .from(spaceChannels)
        .where(eq(spaceChannels.spaceId, spaceId))
        .orderBy(asc(spaceChannels.position));
    }

    return channels;
  },

  /** Create a new channel */
  async createChannel(spaceId: string, params: CreateChannelParams) {
    // Enforce one-per-feed-type for non-chat types
    if (UNIQUE_FEED_TYPES.has(params.type)) {
      const existing = await db
        .select()
        .from(spaceChannels)
        .where(and(eq(spaceChannels.spaceId, spaceId), eq(spaceChannels.type, params.type)))
        .limit(1);
      if (existing.length > 0) {
        throw new Error(`Only one ${params.type} channel is allowed per space`);
      }
    }

    // Get next position
    const channels = await db
      .select()
      .from(spaceChannels)
      .where(eq(spaceChannels.spaceId, spaceId));
    const nextPosition = channels.length;

    const id = nanoid(12);
    const [channel] = await db
      .insert(spaceChannels)
      .values({
        id,
        spaceId,
        type: params.type,
        label: params.label,
        position: nextPosition,
        isDefault: false,
        adminOnly: params.adminOnly ?? false,
        slowModeSeconds: params.slowModeSeconds ?? 0,
      })
      .returning();

    return channel;
  },

  /** Update a channel */
  async updateChannel(channelId: string, updates: UpdateChannelParams) {
    const [channel] = await db
      .update(spaceChannels)
      .set(updates)
      .where(eq(spaceChannels.id, channelId))
      .returning();
    return channel;
  },

  /** Delete a channel (refuses defaults) */
  async deleteChannel(channelId: string) {
    const [channel] = await db
      .select()
      .from(spaceChannels)
      .where(eq(spaceChannels.id, channelId))
      .limit(1);

    if (!channel) throw new Error("Channel not found");
    if (channel.isDefault) throw new Error("Cannot delete a default channel");

    await db.delete(spaceChannels).where(eq(spaceChannels.id, channelId));
  },

  /** Reorder channels */
  async reorderChannels(spaceId: string, orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(spaceChannels)
        .set({ position: i })
        .where(and(eq(spaceChannels.id, orderedIds[i]), eq(spaceChannels.spaceId, spaceId)));
    }
  },

  /** Seed default channels for a new space */
  async seedDefaultChannels(spaceId: string) {
    const values = DEFAULT_CHANNELS.map((ch) => ({
      id: nanoid(12),
      spaceId,
      type: ch.type,
      label: ch.label,
      position: ch.position,
      isDefault: true,
      adminOnly: false,
      slowModeSeconds: 0,
    }));

    await db.insert(spaceChannels).values(values).onConflictDoNothing();
  },
};
