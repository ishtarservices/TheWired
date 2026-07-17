import { useCallback, useEffect, useRef, useState } from "react";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScreenInsets } from "@/components/layout/Screen";
import { Type } from "@/components/ui/Type";
import { type MySpace, type SpaceChannel } from "@/lib/api/spaces";
import { isSpaceFeedType } from "@/lib/nostr/spaceFeedRoutes";
import { useEngine } from "@/lib/nostr/EngineContext";
import {
  getStoredSpacesSelection,
  storeSpacesSelection,
} from "@/platform/appPrefs";
import type { MainTabParamList, SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { GlobalNotesFeed, type GlobalNotesFeedHandle } from "./components/GlobalNotesFeed";
import { SpaceChannelList } from "./components/SpaceChannelList";
import { SpaceSwitcher } from "./components/SpaceSwitcher";
import {
  parseSpaceSelection,
  serializeSpaceSelection,
  type SpaceSelection,
} from "./spacesSelection";
import { useMySpaces } from "./useSpaceMeta";

// The Spaces tab home — single vertical screen (signal redesign): a mono
// "spaces" label over the horizontal switcher (feed · discover · joined
// spaces), with the selection's content swapping in place below (no push).
// Discover is its own pushed section; the full Space screen (hero, join,
// members) opens from the space header. Guests get feed + Discover
// (browse-everything, 5.1.1(v)). The native header is off — this screen owns
// its safe-area top.

type Props = NativeStackScreenProps<SpacesStackParamList, "SpacesHome">;

/** Session memory: reselect where the user left off when the tab remounts.
 *  Primed once from storage so the last-viewed space survives cold starts. */
let lastSelection: SpaceSelection | null = null;

const NO_SPACES: MySpace[] = [];

export function SpacesHomeScreen({ navigation, route }: Props) {
  const insets = useScreenInsets();
  const safe = useSafeAreaInsets();
  const engine = useEngine();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  // Joined spaces from the space-meta cache (hydrated once in App.tsx,
  // refreshed on focus — join/leave flows force-refresh via invalidation).
  const { spaces } = useMySpaces();
  const mySpaces = spaces ?? NO_SPACES;
  // null = storage read in flight (ms; content area renders nothing rather
  // than flashing feed → stored space).
  const [selection, setSelection] = useState<SpaceSelection | null>(lastSelection);

  useEffect(() => {
    if (lastSelection !== null) return;
    let cancelled = false;
    getStoredSpacesSelection().then((raw) => {
      if (cancelled) return;
      const stored = parseSpaceSelection(raw) ?? { kind: "feed" as const };
      lastSelection = stored;
      setSelection((current) => current ?? stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((next: SpaceSelection) => {
    lastSelection = next;
    storeSpacesSelection(serializeSpaceSelection(next));
    setSelection(next);
  }, []);

  // Deep links / notification taps can preselect a space.
  const routeSpaceId = route.params?.spaceId;
  useEffect(() => {
    if (routeSpaceId) select({ kind: "space", spaceId: routeSpaceId });
  }, [routeSpaceId, select]);

  // Live previews/unread for every joined app-relay space — one engine sub;
  // identical sets no-op, so refeeds on every refresh are free. Guests
  // resolve to [] (loadMySpaces' guest path), which closes the sub.
  useEffect(() => {
    engine.setSignalSpaces(
      mySpaces.map((s) => ({ spaceId: s.id, hostRelay: s.hostRelay })),
    );
  }, [engine, mySpaces]);

  // A selected space that's no longer joined falls back to the feed (leaves
  // happen on pushed screens). Guests keep their browsed selection — the
  // joined list is legitimately empty for them.
  useEffect(() => {
    if (!isLoggedIn || spaces === null) return;
    setSelection((current) => {
      if (
        current?.kind === "space" &&
        !spaces.some((s) => s.id === current.spaceId)
      ) {
        lastSelection = { kind: "feed" };
        return lastSelection;
      }
      return current;
    });
  }, [isLoggedIn, spaces]);

  // Tab re-press while already at rest on this screen: TabNavigator's reset
  // returns null (stack already at root), so nothing happens by default —
  // scroll the feed back to top instead. The ref is null while a space is
  // selected, which makes this a no-op there by construction.
  const feedRef = useRef<GlobalNotesFeedHandle>(null);
  useEffect(() => {
    const parent = navigation.getParent<
      BottomTabNavigationProp<MainTabParamList, "SpacesTab">
    >();
    return parent?.addListener("tabPress", () => {
      if (!navigation.isFocused()) return; // deeper in the stack → reset owns it
      feedRef.current?.scrollToTop();
    });
  }, [navigation]);

  const openChannel = useCallback(
    (spaceId: string, channel: SpaceChannel) => {
      if (channel.type === "chat") {
        navigation.navigate("Channel", { spaceId, channelId: channel.id });
      } else if (isSpaceFeedType(channel.type)) {
        navigation.navigate("SpaceFeed", {
          spaceId,
          channelId: channel.id,
          channelType: channel.type,
          label: channel.label,
        });
      }
    },
    [navigation],
  );

  // Stable per-selected-space handlers — SpaceChannelList's memo'd rows keep
  // these in their renderItem deps, so identity may only change when the
  // selected space does (which remounts the list anyway).
  const selectedSpaceId = selection?.kind === "space" ? selection.spaceId : null;
  const openSelectedSpace = useCallback(() => {
    if (selectedSpaceId) navigation.navigate("Space", { spaceId: selectedSpaceId });
  }, [navigation, selectedSpaceId]);
  const openSelectedChannel = useCallback(
    (channel: SpaceChannel) => {
      if (selectedSpaceId) openChannel(selectedSpaceId, channel);
    },
    [openChannel, selectedSpaceId],
  );

  return (
    <View className="flex-1 bg-background">
      {/* Pinned top block — never remounts as the content below swaps. */}
      <View style={{ paddingTop: safe.top + 8 }}>
        <Type
          role="metaLabel"
          className="uppercase text-muted"
          style={{ paddingHorizontal: 16, paddingBottom: 10 }}
        >
          spaces
        </Type>
        <SpaceSwitcher
          spaces={mySpaces}
          selection={selection ?? { kind: "feed" }}
          onSelectFeed={() => select({ kind: "feed" })}
          onSelectSpace={(spaceId) => select({ kind: "space", spaceId })}
          onDiscover={() => navigation.navigate("Discover")}
        />
      </View>

      <View className="mt-2 flex-1">
        {selection === null ? null : selection.kind === "space" ? (
          <SpaceChannelList
            key={selection.spaceId}
            spaceId={selection.spaceId}
            paddingBottom={insets.bottom}
            onOpenSpace={openSelectedSpace}
            onOpenChannel={openSelectedChannel}
          />
        ) : (
          <GlobalNotesFeed ref={feedRef} paddingTop={4} paddingBottom={insets.bottom} />
        )}
      </View>
    </View>
  );
}
