import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Antenna, PenLine } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useScreenInsets } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import { SHADOWS } from "@/theme/constants";
import { useTheme } from "@/theme/ThemeContext";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";

// The Spaces tab's default view (W2): the live global/discover notes feed —
// guests and logged-in alike. The spaces directory joins as a second segment
// in W3. Cold start: SQLite-hydrated events render instantly, skeletons only
// on a truly empty cache, live events stream in on EOSE.

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceList">;

export function SpaceListScreen(_props: Props) {
  const navigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useScreenInsets({ scroll: true });
  // Full tab-bar height (not the scroll inset) — the FAB floats above the bar.
  const fabInsets = useScreenInsets();

  const ids = useAppSelector((s) => s.feed.ids);
  const entities = useAppSelector((s) => s.feed.entities);
  const status = useAppSelector((s) => s.feed.status);
  const [refreshing, setRefreshing] = useState(false);

  const events = useMemo(
    () => ids.map((id) => entities[id]).filter(Boolean),
    [ids, entities],
  );

  // Backfill missing kind-0s for visible authors (engine dedupes in-flight).
  const authorsKey = useMemo(
    () => [...new Set(events.map((e) => e.pubkey))].sort().join(","),
    [events],
  );
  useEffect(() => {
    if (authorsKey) engine.requestProfiles(authorsKey.split(","));
  }, [engine, authorsKey]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.selection();
    engine.refreshFeed().finally(() => setRefreshing(false));
  }, [engine]);

  const renderItem = useCallback(
    ({ item }: { item: NostrEvent }) => <NoteCard event={item} />,
    [],
  );

  const showSkeletons = events.length === 0 && status !== "live";

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 88,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={FeedSeparator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={tokens.muted}
          />
        }
        ListEmptyComponent={
          showSkeletons ? (
            <View className="gap-2.5">
              {Array.from({ length: 6 }, (_, i) => (
                <NoteCardSkeleton key={i} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Antenna}
              title="Nothing here yet"
              message="Notes from the network appear here as relays respond."
            />
          )
        }
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
      />

      {/* Compose FAB — guests hit the sign-in gate inside the composer
          (action-level gating, App Store 5.1.1(v)). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compose a note"
        onPress={() => {
          haptics.tap();
          navigation.navigate("Composer", { mode: "note" });
        }}
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-90"
        style={[{ bottom: fabInsets.bottom + 16 }, SHADOWS.lg]}
      >
        <PenLine size={22} color={tokens.primaryForeground} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

function FeedSeparator() {
  return <View className="h-2.5" />;
}
