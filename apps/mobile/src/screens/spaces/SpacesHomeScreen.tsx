import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { fetchMySpaces, type MySpace, type SpaceChannel } from "@/lib/api/spaces";
import { isSpaceFeedType } from "@/lib/nostr/spaceFeedRoutes";
import { useEngine } from "@/lib/nostr/EngineContext";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { GlobalNotesFeed } from "./components/GlobalNotesFeed";
import { SpacePane } from "./components/SpacePane";
import { SpaceRail, type RailSelection } from "./components/SpaceRail";

// The Spaces tab home — Discord-mobile register, desktop-sidebar structure:
// a side rail (global feed · joined spaces · Discover) with the selection's
// content in the main pane. Discover is its own pushed section; the full
// Space screen (hero/join/members) opens from the pane header. Guests get
// the feed + Discover (browse-everything, 5.1.1(v)).

type Props = NativeStackScreenProps<SpacesStackParamList, "SpacesHome">;

/** Session memory: reselect where the user left off when the tab remounts. */
let lastSelection: RailSelection = { kind: "feed" };

export function SpacesHomeScreen({ navigation, route }: Props) {
  const insets = useScreenInsets();
  const engine = useEngine();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  const [mySpaces, setMySpaces] = useState<MySpace[]>([]);
  const [selection, setSelection] = useState<RailSelection>(lastSelection);

  const select = useCallback((next: RailSelection) => {
    lastSelection = next;
    setSelection(next);
  }, []);

  // Deep links / notification taps can preselect a space's pane.
  const routeSpaceId = route.params?.spaceId;
  useEffect(() => {
    if (routeSpaceId) select({ kind: "space", spaceId: routeSpaceId });
  }, [routeSpaceId, select]);

  // Refresh the rail whenever the tab regains focus (joins/leaves happen on
  // pushed screens); a selected space that's no longer joined falls back to
  // the feed.
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
            if (current.kind === "space" && !spaces.some((s) => s.id === current.spaceId)) {
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
    <View className="flex-1 flex-row bg-background">
      <SpaceRail
        spaces={mySpaces}
        selection={selection}
        onSelectFeed={() => select({ kind: "feed" })}
        onSelectSpace={(spaceId) => select({ kind: "space", spaceId })}
        onDiscover={() => navigation.navigate("Discover")}
        paddingTop={insets.top}
        paddingBottom={insets.bottom}
      />
      <View className="flex-1">
        {selection.kind === "space" ? (
          <SpacePane
            key={selection.spaceId}
            spaceId={selection.spaceId}
            paddingTop={insets.top}
            paddingBottom={insets.bottom}
            onOpenSpace={() => navigation.navigate("Space", { spaceId: selection.spaceId })}
            onOpenChannel={(channel) => openChannel(selection.spaceId, channel)}
          />
        ) : (
          <GlobalNotesFeed paddingTop={insets.top} paddingBottom={insets.bottom} />
        )}
      </View>
    </View>
  );
}
