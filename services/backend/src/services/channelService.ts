import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, and, asc } from "drizzle-orm";

/** Feed types that allow only one channel per space */
const UNIQUE_FEED_TYPES = new Set(["notes", "media", "articles"]);

interface CreateChannelParams {
  type: string;
  label: string;
  categoryId?: string;
  adminOnly?: boolean;
  slowModeSeconds?: number;
  temporary?: boolean;
  feedMode?: string;
}

interface UpdateChannelParams {
  label?: string;
  categoryId?: string | null;
  position?: number;
  adminOnly?: boolean;
  slowModeSeconds?: number;
  isDefault?: boolean;
  feedMode?: string;
}

const DEFAULT_CHANNELS: Array<{ type: string; label: string }> = [
  { type: "chat", label: "#chat" },
  { type: "notes", label: "#notes" },
  { type: "media", label: "#media" },
  { type: "articles", label: "#articles" },
  { type: "music", label: "#music" },
];

export const channelService = {
  /** List channels for a space */
  async listChannels(spaceId: string) {
    const channels = await db
      .select()
      .from(spaceChannels)
      .where(eq(spaceChannels.spaceId, spaceId))
      .orderBy(asc(spaceChannels.position));

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

    // If this is the first channel, make it the default
    const isFirst = channels.length === 0;

    const id = nanoid(12);
    const [channel] = await db
      .insert(spaceChannels)
      .values({
        id,
        spaceId,
        type: params.type,
        label: params.label,
        categoryId: params.categoryId ?? null,
        position: nextPosition,
        isDefault: isFirst,
        adminOnly: params.adminOnly ?? false,
        slowModeSeconds: params.slowModeSeconds ?? 0,
        temporary: params.temporary ?? false,
        feedMode: params.feedMode ?? "all",
      })
      .returning();

    return channel;
  },

  /** Update a channel. Scoped to (spaceId, channelId) — a channel id from another
   *  space yields 0 rows (route 404s), closing the cross-space IDOR (#14). */
  async updateChannel(spaceId: string, channelId: string, updates: UpdateChannelParams) {
    // Verify the channel belongs to this space before any mutation.
    const [existing] = await db
      .select()
      .from(spaceChannels)
      .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
      .limit(1);
    if (!existing) return undefined;

    // If setting isDefault, clear it from all other channels in the (verified) space.
    if (updates.isDefault) {
      await db
        .update(spaceChannels)
        .set({ isDefault: false })
        .where(eq(spaceChannels.spaceId, spaceId));
    }

    const [channel] = await db
      .update(spaceChannels)
      .set(updates)
      .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
      .returning();
    return channel;
  },

  /** Delete a channel (scoped to its space). When deleting the default, promotes the next. */
  async deleteChannel(spaceId: string, channelId: string) {
    const [channel] = await db
      .select()
      .from(spaceChannels)
      .where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)))
      .limit(1);

    if (!channel) throw new Error("Channel not found");

    await db.delete(spaceChannels).where(and(eq(spaceChannels.id, channelId), eq(spaceChannels.spaceId, spaceId)));

    // If this was the default channel, promote the next one by position
    if (channel.isDefault) {
      const remaining = await db
        .select()
        .from(spaceChannels)
        .where(eq(spaceChannels.spaceId, channel.spaceId))
        .orderBy(asc(spaceChannels.position))
        .limit(1);

      if (remaining.length > 0) {
        await db
          .update(spaceChannels)
          .set({ isDefault: true })
          .where(eq(spaceChannels.id, remaining[0].id));
      }
    }
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

  /** Seed specific channels for a new space */
  async seedChannels(spaceId: string, types: Array<{ type: string; label: string }>) {
    for (let i = 0; i < types.length; i++) {
      const ch = types[i];
      await db
        .insert(spaceChannels)
        .values({
          id: nanoid(12),
          spaceId,
          type: ch.type,
          label: ch.label,
          position: i,
          isDefault: i === 0, // First channel is the home channel
          adminOnly: false,
          slowModeSeconds: 0,
        })
        .onConflictDoNothing({ target: [spaceChannels.spaceId, spaceChannels.type, spaceChannels.label] });
    }
  },

  /** Seed all default channels (legacy fallback) */
  async seedDefaultChannels(spaceId: string) {
    await this.seedChannels(spaceId, DEFAULT_CHANNELS);
  },
};
