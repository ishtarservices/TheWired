import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Antenna, PenLine } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { EmptyState } from "@/components/ui/EmptyState";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import { SHADOWS } from "@/theme/constants";
import { useTheme } from "@/theme/ThemeContext";
import { useAppSelector } from "@/store/hooks";

// The live global notes feed — the Spaces home's "feed" pane (guest-visible
// live surface, W2 exit criterion). Compose FAB gates at the action inside
// the composer (5.1.1(v)).

export function GlobalNotesFeed({
  paddingTop,
  paddingBottom,
}: {
  paddingTop: number;
  paddingBottom: number;
}) {
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const noteActions = useNoteActions();

  const ids = useAppSelector((s) => s.feed.ids);
  const entities = useAppSelector((s) => s.feed.entities);
  const status = useAppSelector((s) => s.feed.status);
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const [refreshing, setRefreshing] = useState(false);

  const events = useMemo(
    () => ids.map((id) => entities[id]).filter((e) => e && !muted[e.pubkey]),
    [ids, entities, muted],
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

  const renderNote = useCallback(
    ({ item }: { item: NostrEvent }) => (
      <NoteCard
        event={item}
        onPress={() => rootNavigation.navigate("NoteThread", { noteId: item.id })}
        onLongPress={() => noteActions.open(item)}
      />
    ),
    [rootNavigation, noteActions],
  );

  const showSkeletons = events.length === 0 && status !== "live";

  return (
    <View className="flex-1">
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderNote}
        contentContainerStyle={{
          paddingTop: paddingTop + 8,
          paddingBottom: paddingBottom + 88,
          paddingHorizontal: 12,
        }}
        ItemSeparatorComponent={RowSeparator}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.muted} />
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compose a note"
        onPress={() => {
          haptics.tap();
          rootNavigation.navigate("Composer", { mode: "note" });
        }}
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-90"
        style={[{ bottom: paddingBottom + 16 }, SHADOWS.lg]}
      >
        <PenLine size={22} color={tokens.primaryForeground} strokeWidth={2} />
      </Pressable>

      {noteActions.sheet}
    </View>
  );
}

function RowSeparator() {
  return <View className="h-2.5" />;
}
