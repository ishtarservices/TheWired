import type { ChannelRoute } from "../../types/space";
import { EVENT_KINDS } from "../../types/nostr";

export const CHANNEL_ROUTES: Record<string, ChannelRoute> = {
  chat: {
    kinds: [EVENT_KINDS.CHAT_MESSAGE],
    usesHTag: true,
    pageSize: 50,
    sortOrder: "asc",
  },
  reels: {
    kinds: [EVENT_KINDS.VIDEO_VERTICAL, EVENT_KINDS.VIDEO_VERTICAL_ADDR],
    usesHTag: true,
    pageSize: 20,
    sortOrder: "desc",
  },
  "long-form": {
    kinds: [EVENT_KINDS.LONG_FORM],
    usesHTag: true,
    pageSize: 10,
    sortOrder: "desc",
  },
  announcements: {
    kinds: [EVENT_KINDS.SHORT_TEXT],
    usesHTag: true,
    pageSize: 20,
    sortOrder: "desc",
    adminOnly: true,
  },
  live: {
    kinds: [EVENT_KINDS.LIVE_STREAM, EVENT_KINDS.LIVE_CHAT],
    usesHTag: true,
    pageSize: 0,
    sortOrder: "desc",
    paginated: false,
  },
  music: {
    kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM],
    usesHTag: true,
    pageSize: 30,
    sortOrder: "desc",
  },
};

export function getChannelRoute(channelType: string): ChannelRoute | undefined {
  return CHANNEL_ROUTES[channelType];
}
