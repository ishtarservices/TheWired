import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Antenna, Boxes, PenLine, Users } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { useScreenInsets } from "@/components/layout/Screen";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import { fetchListedSpaces, type ListedSpace } from "@/lib/api/discovery";
import { SHADOWS } from "@/theme/constants";
import { useTheme } from "@/theme/ThemeContext";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";

// The Spaces tab (W2+W3): two segments — the live global notes feed and the
// backend's public spaces directory. Both fully guest-browsable; writes gate
// at the action (composer). Space detail beyond the directory row is the
// next phase (join/channels/chat need the shared core).

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceList">;

type SpacesView = "notes" | "spaces";

export function SpaceListScreen({ navigation }: Props) {
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useScreenInsets({ scroll: true });
  const fabInsets = useScreenInsets();
  const noteActions = useNoteActions();

  const [view, setView] = useState<SpacesView>("notes");

  // ── notes segment ──────────────────────────────────────────────────
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

  // ── spaces segment ─────────────────────────────────────────────────
  const [spaces, setSpaces] = useState<ListedSpace[] | null>(null);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  const loadSpaces = useCallback(() => {
    setSpacesError(null);
    fetchListedSpaces({ sort: "trending" })
      .then(setSpaces)
      .catch((e) => {
        setSpaces([]);
        setSpacesError(e instanceof Error ? e.message : "Couldn't load the directory.");
      });
  }, []);

  useEffect(() => {
    if (view === "spaces" && spaces === null) loadSpaces();
  }, [view, spaces, loadSpaces]);

  const renderSpace = useCallback(
    ({ item }: { item: ListedSpace }) => (
      <Card
        onPress={() => navigation.navigate("Space", { spaceId: item.id })}
        className="flex-row items-center gap-3"
      >
        <Avatar uri={item.picture} name={item.name} pubkey={item.id} size={48} />
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Type role="body" weight={600} className="shrink text-heading" numberOfLines={1}>
              {item.name}
            </Type>
            {item.featured ? <Pill label="featured" tone="primary" /> : null}
          </View>
          {item.about ? (
            <Type role="caption" className="mt-0.5 leading-4 text-muted" numberOfLines={2}>
              {item.about}
            </Type>
          ) : null}
          <View className="mt-1.5 flex-row items-center gap-3">
            <View className="flex-row items-center gap-1">
              <Users size={12} color={tokens.faint} />
              <Type role="micro" tabular className="text-faint">
                {item.memberCount}
              </Type>
            </View>
            {item.category ? (
              <Type role="micro" className="lowercase text-faint">
                {item.category}
              </Type>
            ) : null}
          </View>
        </View>
      </Card>
    ),
    [navigation, tokens],
  );

  const segmentedHeader = (
    <View className="pb-3">
      <SegmentedControl<SpacesView>
        options={[
          { value: "notes", label: "notes" },
          { value: "spaces", label: "spaces" },
        ]}
        value={view}
        onChange={setView}
      />
    </View>
  );

  if (view === "spaces") {
    return (
      <View className="flex-1 bg-background">
        <FlatList
          data={spaces ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderSpace}
          ListHeaderComponent={segmentedHeader}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingTop: insets.top,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 16,
          }}
          ItemSeparatorComponent={RowSeparator}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={() => {
                haptics.selection();
                setSpaces(null);
              }}
              tintColor={tokens.muted}
            />
          }
          ListEmptyComponent={
            spaces === null ? (
              <View className="gap-2.5">
                {Array.from({ length: 5 }, (_, i) => (
                  <SpaceRowSkeleton key={i} />
                ))}
              </View>
            ) : (
              <EmptyState
                icon={Boxes}
                title={spacesError ? "Directory unavailable" : "No listed spaces"}
                message={spacesError ?? "Public spaces appear here once listed."}
                action={
                  spacesError ? (
                    <Button variant="secondary" onPress={() => setSpaces(null)}>
                      Try again
                    </Button>
                  ) : undefined
                }
              />
            )
          }
        />
      </View>
    );
  }

  const showSkeletons = events.length === 0 && status !== "live";

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderNote}
        ListHeaderComponent={segmentedHeader}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 88,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={RowSeparator}
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
          rootNavigation.navigate("Composer", { mode: "note" });
        }}
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-full bg-primary active:opacity-90"
        style={[{ bottom: fabInsets.bottom + 16 }, SHADOWS.lg]}
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

function SpaceRowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-card p-4">
      <SkeletonCircle size={48} />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-32" />
        <SkeletonText lines={1} />
      </View>
    </View>
  );
}
