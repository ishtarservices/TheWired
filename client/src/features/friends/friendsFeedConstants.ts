import type { SpaceChannel, SpaceChannelType } from "../../types/space";

/** Sentinel space ID for the Friends Feed virtual space */
export const FRIENDS_FEED_ID = "__friends_feed__";

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
  },
];
