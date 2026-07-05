// ─── Deep links (guide 03 §7) ────────────────────────────────────────
// thewired:// + nostr: schemes (app.json) and https://thewired.app universal
// links all resolve here. Bare nostr entities (npub/nprofile/note/nevent/naddr)
// are decoded via nip19 into the matching root screen.

import * as Linking from "expo-linking";
import { getStateFromPath, type LinkingOptions } from "@react-navigation/native";
import { nip19 } from "nostr-tools";

import type { RootStackParamList } from "./types";

type ResultState = ReturnType<typeof getStateFromPath>;

function rootScreen(name: keyof RootStackParamList, params: object): ResultState {
  // Keep the tab shell beneath the pushed screen so back lands in the app.
  return {
    routes: [{ name: "Tabs" }, { name, params }],
  } as unknown as ResultState;
}

/** nostr:npub… / note… / nevent… / naddr… → Profile / NoteThread / Article. */
function stateFromNostrEntity(path: string): ResultState | undefined {
  const entity = path.replace(/^\/+/, "").split("?")[0];
  if (!/^(npub|nprofile|note|nevent|naddr)1[a-z0-9]+$/.test(entity)) return undefined;

  try {
    const decoded = nip19.decode(entity);
    switch (decoded.type) {
      case "npub":
        return rootScreen("Profile", { pubkey: decoded.data });
      case "nprofile":
        return rootScreen("Profile", { pubkey: decoded.data.pubkey });
      case "note":
        return rootScreen("NoteThread", { noteId: decoded.data });
      case "nevent":
        return rootScreen("NoteThread", { noteId: decoded.data.id });
      case "naddr":
        // TODO: route music naddrs (31683/33123) to the Music tab once those
        // screens exist (desktop MusicLinkResolver logic).
        return rootScreen("Article", { naddr: entity });
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Linking.createURL("/"), // thewired:// (exp:// in Expo Go dev)
    "https://thewired.app",
    "nostr:",
  ],
  config: {
    screens: {
      Tabs: {
        screens: {
          SpacesTab: { screens: { SpaceList: "spaces" } },
          MusicTab: { screens: { MusicHome: "music" } },
          MessagesTab: {
            screens: { DMList: "dm", DMConversation: "dm/:pubkey" },
          },
          AITab: { screens: { AIChatList: "ai" } },
          YouTab: { screens: { You: "you", Settings: "settings" } },
        },
      },
      Profile: "profile/:pubkey",
      NoteThread: "note/:noteId",
      Article: "article/:naddr",
      JoinSpace: "invite/:code",
      Composer: "compose",
    },
  },
  getStateFromPath(path, options) {
    return stateFromNostrEntity(path) ?? getStateFromPath(path, options);
  },
};
