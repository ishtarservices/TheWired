import { EVENT_KINDS } from "../../types/nostr";
import type { SpaceChannelType, SpaceChannelRoute } from "../../types/space";

export const SPACE_CHANNEL_ROUTES: Record<SpaceChannelType, SpaceChannelRoute> = {
  chat: {
    kinds: [EVENT_KINDS.CHAT_MESSAGE],
    filterMode: "htag",
    pageSize: 50,
    sortOrder: "asc",
  },
  notes: {
    kinds: [EVENT_KINDS.SHORT_TEXT],
    filterMode: "authors",
    pageSize: 30,
    sortOrder: "desc",
  },
  media: {
    kinds: [
      EVENT_KINDS.PICTURE,
      EVENT_KINDS.VIDEO_HORIZONTAL,
      EVENT_KINDS.VIDEO_VERTICAL,
      EVENT_KINDS.VIDEO_HORIZONTAL_ADDR,
      EVENT_KINDS.VIDEO_VERTICAL_ADDR,
    ],
    filterMode: "authors",
    pageSize: 20,
    sortOrder: "desc",
  },
  articles: {
    kinds: [EVENT_KINDS.LONG_FORM],
    filterMode: "authors",
    pageSize: 10,
    sortOrder: "desc",
  },
  music: {
    kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM],
    filterMode: "authors",
    pageSize: 30,
    sortOrder: "desc",
  },
};

export function getSpaceChannelRoute(
  channelType: string,
): SpaceChannelRoute | undefined {
  return SPACE_CHANNEL_ROUTES[channelType as SpaceChannelType];
}
