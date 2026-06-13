import type { SpaceChannel, SpaceChannelType } from "../../types/space";
import { getSpaceChannelRoute } from "../spaces/spaceChannelRoutes";
import { EVENT_KINDS } from "../../types/nostr";

/** Sentinel space ID for the Friends Feed virtual space */
export const FRIENDS_FEED_ID = "__friends_feed__";

/**
 * Kinds to subscribe for a Feed channel. Appends reposts (kind:6) to the notes
 * channel when the pref is on — deliberately NOT added to the shared
 * SPACE_CHANNEL_ROUTES, which would change real space feeds too.
 */
export function getFriendsFeedKinds(
  channelType: string,
  showReposts: boolean,
): number[] | undefined {
  const route = getSpaceChannelRoute(channelType);
  if (!route) return undefined;
  if (channelType === "notes" && showReposts) {
    return [...route.kinds, EVENT_KINDS.REPOST];
  }
  return route.kinds;
}

/** Hardcoded channels for the Friends Feed */
export const FRIENDS_FEED_CHANNELS: SpaceChannel[] = [
  {
    id: "notes",
    spaceId: FRIENDS_FEED_ID,
    type: "notes" as SpaceChannelType,
    label: "Notes",
    position: 0,
    isDefault: true,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
  },
  {
    id: "media",
    spaceId: FRIENDS_FEED_ID,
    type: "media" as SpaceChannelType,
    label: "Media",
    position: 1,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
  },
  {
    id: "articles",
    spaceId: FRIENDS_FEED_ID,
    type: "articles" as SpaceChannelType,
    label: "Articles",
    position: 2,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
  },
];
