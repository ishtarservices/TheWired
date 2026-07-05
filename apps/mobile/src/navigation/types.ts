// ─── Navigation model ────────────────────────────────────────────────
// guide 03 §2: the desktop's four sidebarMode values + the sidebar-footer
// profile become five bottom tabs; drill-downs are per-tab native stacks;
// cross-cutting + modal screens live in a root stack above the tabs.

import type { NavigatorScreenParams } from "@react-navigation/native";

export type SpacesStackParamList = {
  SpaceList: undefined;
  Space: { spaceId: string };
  Channel: { spaceId: string; channelId: string };
  Thread: { spaceId: string; channelId: string; rootEventId: string };
};

export type MusicStackParamList = {
  MusicHome: undefined;
  Album: { albumRef: string };
};

export type MessagesStackParamList = {
  DMList: undefined;
  DMConversation: { pubkey: string };
};

export type AIStackParamList = {
  AIChatList: undefined;
  AIConversation: { conversationId: string };
};

export type YouStackParamList = {
  You: undefined;
  Settings: undefined;
};

export type MainTabParamList = {
  SpacesTab: NavigatorScreenParams<SpacesStackParamList>;
  MusicTab: NavigatorScreenParams<MusicStackParamList>;
  MessagesTab: NavigatorScreenParams<MessagesStackParamList>;
  AITab: NavigatorScreenParams<AIStackParamList>;
  YouTab: NavigatorScreenParams<YouStackParamList>;
};

export type RootStackParamList = {
  // Auth (rendered instead of Tabs while logged out)
  Welcome: undefined;
  CreateIdentity: undefined;
  Login: undefined;

  Tabs: NavigatorScreenParams<MainTabParamList>;

  // Cross-cutting pushes (reachable from any tab / deep link)
  Profile: { pubkey: string };
  NoteThread: { noteId: string };
  Article: { naddr: string };

  // Modals / sheets
  JoinSpace: { code: string };
  NowPlaying: undefined;
  Composer: { mode: "note" | "reply" | "quote"; targetEventId?: string } | undefined;
  MediaLightbox: { srcs: string[]; startIndex?: number };
  IncomingCall: { callId: string; peerPubkey: string };
};

declare global {
  // Makes useNavigation() typed app-wide without per-call generics.
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
