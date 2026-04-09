export interface TourStep {
  id: string;
  target: string; // data-tour attribute value
  title: string;
  description: string;
  /** Navigation actions to run before showing this step */
  beforeShow: {
    sidebarMode?: "spaces" | "music" | "messages";
    route?: string;
    activateFriendsFeed?: boolean;
  };
  /** Where to position the info card relative to the spotlight */
  cardPosition: "right" | "bottom" | "center";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "spaces",
    target: "sidebar-spaces",
    title: "Spaces",
    description:
      "Community rooms where people gather. Each space has channels for chat, notes, media, music, and more. Join existing spaces or create your own.",
    beforeShow: { sidebarMode: "spaces", route: "/" },
    cardPosition: "right",
  },
  {
    id: "music",
    target: "sidebar-music",
    title: "Music",
    description:
      "Upload, discover, and organize music. Build your library, create playlists, follow artists, and track your insights. All stored on Nostr.",
    beforeShow: { sidebarMode: "music" },
    cardPosition: "right",
  },
  {
    id: "messages",
    target: "sidebar-messages",
    title: "Messages",
    description:
      "End-to-end encrypted direct messages. Add friends, send messages, and chat privately. No one can read your messages except you and the recipient.",
    beforeShow: { sidebarMode: "messages", route: "/dm" },
    cardPosition: "right",
  },
  {
    id: "discover",
    target: "discover-page",
    title: "Discover",
    description:
      "Find new spaces to join, explore relay servers, and discover people to follow. There's always more to explore on The Wired.",
    beforeShow: { route: "/discover" },
    cardPosition: "center",
  },
  {
    id: "friends-feed",
    target: "center-panel",
    title: "Friends Feed",
    description:
      "A personalized feed of notes, media, and articles from people you follow. Follow more people to see more content here.",
    beforeShow: { sidebarMode: "spaces", route: "/", activateFriendsFeed: true },
    cardPosition: "center",
  },
  {
    id: "settings",
    target: "settings-content",
    title: "Settings",
    description:
      "Customize your profile, theme, relays, notifications, and security. You can re-run this tour anytime from the App tab.",
    beforeShow: { route: "/settings" },
    cardPosition: "center",
  },
];
