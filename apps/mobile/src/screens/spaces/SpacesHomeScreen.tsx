import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScreenInsets } from "@/components/layout/Screen";
import { Type } from "@/components/ui/Type";
import { fetchMySpaces, type MySpace, type SpaceChannel } from "@/lib/api/spaces";
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

export function SpacesHomeScreen({ navigation, route }: Props) {
  const insets = useScreenInsets();
  const safe = useSafeAreaInsets();
  const engine = useEngine();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
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

  // Refresh the switcher whenever the tab regains focus (joins/leaves happen
  // on pushed screens); a selected space that's no longer joined falls back
  // to the feed.
  useFocusEffect(
    useCallback(() => {
      const signer = engine.getSigner();
      if (!isLoggedIn || !signer) {
        setMySpaces([]);
        return;
      }
      let cancelled = false;
      fetchMySpaces(signer)
        .then((spaces) => {
          if (cancelled) return;
          setMySpaces(spaces);
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
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [engine, isLoggedIn]),
  );

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
            onOpenSpace={() =>
              navigation.navigate("Space", { spaceId: selection.spaceId })
            }
            onOpenChannel={(channel) => openChannel(selection.spaceId, channel)}
          />
        ) : (
          <GlobalNotesFeed ref={feedRef} paddingTop={4} paddingBottom={insets.bottom} />
        )}
      </View>
    </View>
  );
}
