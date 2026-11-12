import { nanoid } from "../lib/id.js";
import { db } from "../db/connection.js";
import { spaceChannels } from "../db/schema/channels.js";
import { eq, asc } from "drizzle-orm";
import { channelLayoutService, type CopyAuthority } from "./channelLayoutService.js";

/** Feed types that allow only one channel per space */
const UNIQUE_FEED_TYPES = new Set(["notes", "media", "articles"]);

interface CreateChannelParams {
  type: string;
  label: string;
  categoryId?: string | null;
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
      .orderBy(asc(spaceChannels.position), asc(spaceChannels.id));

    return channels;
  },

  /** Create a channel. `categoryId` may be a category id or (older clients) its name. */
  async createChannel(spaceId: string, params: CreateChannelParams) {
    return channelLayoutService.createChannel(spaceId, params, UNIQUE_FEED_TYPES, () => nanoid(12));
  },

  /** Update a channel, scoped to (spaceId, channelId): a channel id from another
   *  space yields undefined (route 404s), closing the cross-space IDOR (#14). */
  async updateChannel(spaceId: string, channelId: string, updates: UpdateChannelParams, authority: CopyAuthority) {
    return channelLayoutService.updateChannel(spaceId, channelId, updates, authority);
  },

  /** Delete a channel (scoped to its space). When deleting the default, promotes the next. */
  async deleteChannel(spaceId: string, channelId: string) {
    await channelLayoutService.deleteChannel(spaceId, channelId);
  },

  /** Legacy flat reorder; normalized into the canonical category grouping. */
  async reorderChannels(spaceId: string, orderedIds: string[]) {
    await channelLayoutService.reorderChannels(spaceId, orderedIds);
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
