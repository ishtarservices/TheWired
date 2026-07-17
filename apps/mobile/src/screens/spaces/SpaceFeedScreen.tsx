import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BookOpen, FileText, Image as ImageIcon, Music } from "lucide-react-native";
import {
  FlatList,
  RefreshControl,
  View,
  useWindowDimensions,
  type ViewToken,
} from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { useScreenInsets } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import {
  fetchFeedSources,
  fetchSpaceMemberPubkeys,
} from "@/lib/api/spaces";
import { cachedSpaceChannels, cachedSpaceDetail } from "@/lib/api/spaceCache";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import { EngagementWindow } from "@/lib/nostr/engagementWindow";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { useBackFallback } from "@/navigation/useBackFallback";
import { openThread as openThreadNav } from "@/navigation/openThread";
import {
  buildSpaceFeedFilters,
  selectFeedAuthors,
  SPACE_FEED_ROUTES,
  type SpaceFeedType,
} from "@/lib/nostr/spaceFeedRoutes";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { markChannelRead } from "@/store/spacePreviews";
import { spaceMusicArtworkSeen } from "@/store/slices/spacePreviewsSlice";
import { useTheme } from "@/theme/ThemeContext";
import { articleNaddr, parseArticleEvents, type ArticleItem } from "./articleParser";
import { parseMediaEvents, type MediaItem } from "./mediaEventParser";
import { parseMusicEvents, type MusicItem } from "./musicEventParser";
import { ArticleCard } from "./components/ArticleCard";
import { MediaGridTile } from "./components/MediaGridTile";
import { TrackRow } from "./components/TrackRow";

// One screen for the four authors-mode channel types (notes/media/articles/
// music). Members publish this content to their own relays, so pages come
// from the engine's read set (desktop parity: groupSubscriptions queries all
// read relays for feed channels — only chat pins the hostRelay). One-shot
// pages + `until` pagination; dedupe by id across pages.

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceFeed">;

const EMPTY_COPY: Record<SpaceFeedType, { icon: typeof FileText; message: string }> = {
  notes: { icon: FileText, message: "Notes from this space's members appear here." },
  media: { icon: ImageIcon, message: "Photos and videos from members appear here." },
  articles: { icon: BookOpen, message: "Long-form posts from members appear here." },
  music: { icon: Music, message: "Tracks and albums from members appear here." },
};

const GRID_GAP = 3;
const FETCH_TIMEOUT_MS = 8000;

type FeedItem =
  | { kind: "note"; key: string; event: NostrEvent }
  | { kind: "media"; key: string; media: MediaItem }
  | { kind: "article"; key: string; article: ArticleItem }
  | { kind: "music"; key: string; music: MusicItem };

export function SpaceFeedScreen({ route, navigation }: Props) {
  const { spaceId, channelId, channelType } = route.params;
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useScreenInsets({ scroll: true });
  const noteActions = useNoteActions();
  const dispatch = useAppDispatch();
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);

  const [events, setEvents] = useState<NostrEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hostRelay, setHostRelay] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const authorsRef = useRef<string[] | null>(null);
  const seenIds = useRef(new Set<string>());

  // Deep-linked (single-route) mounts have no parent — "up" goes to the space.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Space", { spaceId }), [navigation, spaceId]),
  );

  // Deep links swap route params on the SAME screen instance — drop all
  // per-channel state before the (re)load effect below runs.
  useEffect(() => {
    authorsRef.current = null;
    seenIds.current = new Set();
    setEvents(null);
    setHasMore(true);
  }, [spaceId, channelId, channelType]);

  // Opening the feed reads it (SpacesHome unread/opacity state).
  useEffect(() => {
    dispatch(markChannelRead(spaceId, channelId));
  }, [dispatch, spaceId, channelId]);

  // Viewport-windowed engagement for the notes channel — same wiring as
  // GlobalNotesFeed. Root cards get live reply/like/zap counts, which also
  // powers the reply peek ("view replies · N" only shows when counts exist).
  const windowRef = useRef<EngagementWindow | null>(null);
  if (!windowRef.current) windowRef.current = new EngagementWindow(engine);
  useEffect(() => () => windowRef.current?.dispose(), []);
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 1 },
      onViewableItemsChanged: ({ changed }: { changed: ViewToken[] }) => {
        for (const token of changed) {
          const item = token.item as FeedItem | undefined;
          if (item?.kind === "note") {
            windowRef.current?.report(item.event.id, token.index ?? 0, token.isViewable);
          }
        }
      },
    },
  ]).current;

  /** Space context → whose content fills this channel. Resolved once. */
  const resolveAuthors = useCallback(async (): Promise<string[]> => {
    if (authorsRef.current) return authorsRef.current;
    const [detail, channels, members, feedSources] = await Promise.all([
      cachedSpaceDetail(spaceId),
      cachedSpaceChannels(spaceId).catch(() => []),
      fetchSpaceMemberPubkeys(spaceId),
      fetchFeedSources(spaceId),
    ]);
    setHostRelay(detail.hostRelay);
    const channel = channels.find((c) => c.id === channelId);
    const curated = channel?.feedMode === "curated" || detail.mode === "read";
    const authors = selectFeedAuthors({ members, feedSources, curated });
    authorsRef.current = authors;
    return authors;
  }, [spaceId, channelId]);

  const fetchPage = useCallback(
    async (until?: number): Promise<NostrEvent[]> => {
      const authors = await resolveAuthors();
      const filters = buildSpaceFeedFilters(channelType, authors, until);
      if (filters.length === 0) return [];
      return engine.fetchEvents(filters, FETCH_TIMEOUT_MS);
    },
    [resolveAuthors, channelType, engine],
  );

  const mergePage = useCallback((page: NostrEvent[], reset: boolean) => {
    setEvents((prev) => {
      const base = reset ? [] : prev ?? [];
      if (reset) seenIds.current = new Set(base.map((e) => e.id));
      const fresh = page.filter((e) => {
        if (seenIds.current.has(e.id)) return false;
        seenIds.current.add(e.id);
        return true;
      });
      // A page with nothing new means we've drained the window.
      if (!reset && fresh.length === 0) setHasMore(false);
      return [...base, ...fresh].sort((a, b) => b.created_at - a.created_at);
    });
  }, []);

  const loadInitial = useCallback(() => {
    setError(null);
    fetchPage()
      .then((page) => {
        setHasMore(page.length > 0);
        mergePage(page, true);
      })
      .catch((e) => {
        setEvents((prev) => prev ?? []);
        setError(e instanceof Error ? e.message : "Couldn't load this channel.");
      });
  }, [fetchPage, mergePage]);

  useEffect(loadInitial, [loadInitial]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.selection();
    fetchPage()
      .then((page) => mergePage(page, true))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [fetchPage, mergePage]);

  const onLoadMore = useCallback(() => {
    if (loadingMore || !events || events.length === 0) return;
    setLoadingMore(true);
    const oldest = events[events.length - 1].created_at - 1;
    fetchPage(oldest)
      .then((page) => mergePage(page, false))
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [loadingMore, events, fetchPage, mergePage]);

  // Backfill kind-0s for visible authors.
  const authorsKey = useMemo(
    () => [...new Set((events ?? []).map((e) => e.pubkey))].sort().join(","),
    [events],
  );
  useEffect(() => {
    if (authorsKey) engine.requestProfiles(authorsKey.split(","));
  }, [engine, authorsKey]);

  const items = useMemo<FeedItem[]>(() => {
    const visible = (events ?? []).filter((e) => !muted[e.pubkey]);
    switch (channelType) {
      case "notes":
        // Roots only — replies belong to their threads (desktop isRootNote).
        return visible
          .filter((e) => !e.tags.some((t) => t[0] === "e"))
          .map((e) => ({ kind: "note", key: e.id, event: e }));
      case "media":
        return parseMediaEvents(visible).map((m) => ({ kind: "media", key: m.id, media: m }));
      case "articles":
        return parseArticleEvents(visible).map((a) => ({
          kind: "article",
          key: a.id,
          article: a,
        }));
      case "music":
        return parseMusicEvents(visible).map((m) => ({ kind: "music", key: m.id, music: m }));
    }
  }, [events, muted, channelType]);

  // Cover art the music feed just fetched feeds the SpacesHome releases row
  // (spacePreviews slice) — reuse of this page, never a new subscription.
  useEffect(() => {
    if (channelType !== "music") return;
    const artworks = items.flatMap((i) =>
      i.kind === "music" && i.music.artwork ? [i.music.artwork] : [],
    );
    if (artworks.length > 0) {
      dispatch(spaceMusicArtworkSeen({ spaceId, artworks }));
    }
  }, [dispatch, spaceId, channelType, items]);

  // Media grid geometry (3 columns inside the 16pt screen padding).
  const tileSize = Math.floor((width - 32 - GRID_GAP * 2) / 3);
  const gridImages = useMemo(
    () =>
      channelType === "media"
        ? items.flatMap((i) => (i.kind === "media" && i.media.type === "image" ? [i.media.src] : []))
        : [],
    [items, channelType],
  );

  const openMedia = useCallback(
    (media: MediaItem) => {
      if (media.type === "image") {
        const startIndex = Math.max(0, gridImages.indexOf(media.src));
        rootNavigation.navigate("MediaLightbox", { srcs: gridImages, startIndex });
      } else {
        rootNavigation.navigate("VideoPlayer", { src: media.src });
      }
    },
    [gridImages, rootNavigation],
  );

  const openThread = useCallback(
    (note: NostrEvent) =>
      openThreadNav(rootNavigation, {
        noteId: note.id,
        rootId: parseThreadRef(note).rootId ?? note.id,
      }),
    [rootNavigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => {
      switch (item.kind) {
        case "note":
          return (
            <NoteCard
              event={item.event}
              onPress={openThread}
              onLongPress={noteActions.open}
              footer={noteActions.footer}
              peek
            />
          );
        case "media":
          return (
            <MediaGridTile
              item={item.media}
              size={tileSize}
              onPress={() => openMedia(item.media)}
              onLongPress={() => noteActions.open(item.media.event)}
            />
          );
        case "article":
          return (
            <ArticleCard
              article={item.article}
              onPress={() =>
                rootNavigation.navigate("Article", {
                  naddr: articleNaddr(item.article, hostRelay),
                })
              }
              onLongPress={() => noteActions.open(item.article.event)}
            />
          );
        case "music":
          return <TrackRow item={item.music} onLongPress={() => noteActions.open(item.music.event)} />;
      }
    },
    [rootNavigation, noteActions, tileSize, openMedia, hostRelay, openThread],
  );

  const isGrid = channelType === "media";
  const loading = events === null;
  const empty = EMPTY_COPY[channelType];
  const pageSize = SPACE_FEED_ROUTES[channelType].pageSize;

  return (
    <View className="flex-1 bg-background">
      <FlatList
        // numColumns can't change on a live list — remount per channel type
        // (route params swap in place on deep links).
        key={channelType}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        numColumns={isGrid ? 3 : 1}
        columnWrapperStyle={isGrid ? { gap: GRID_GAP } : undefined}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 24,
          // Notes are flat full-bleed rows (NoteCard owns padding + hairline
          // divider); the other channel types keep the inset layout.
          paddingHorizontal: channelType === "notes" ? 0 : 16,
        }}
        ItemSeparatorComponent={
          isGrid ? GridSeparator : channelType === "notes" ? undefined : RowSeparator
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.muted} />
        }
        ListEmptyComponent={
          loading ? (
            <FeedSkeleton channelType={channelType} tileSize={tileSize} />
          ) : (
            <EmptyState
              icon={empty.icon}
              title={error ? "Channel unavailable" : "Nothing here yet"}
              message={error ?? empty.message}
              action={
                error ? (
                  <Button variant="secondary" onPress={loadInitial}>
                    Try again
                  </Button>
                ) : undefined
              }
            />
          )
        }
        ListFooterComponent={
          !loading && items.length > 0 ? (
            <View className="items-center pt-4">
              {hasMore && (events?.length ?? 0) >= pageSize ? (
                <Button variant="secondary" size="sm" loading={loadingMore} onPress={onLoadMore}>
                  Load more
                </Button>
              ) : (
                <Type role="micro" className="text-faint">
                  no more to load
                </Type>
              )}
            </View>
          ) : null
        }
      />
      {noteActions.sheet}
    </View>
  );
}

function RowSeparator() {
  return <View className="h-2.5" />;
}

function GridSeparator() {
  return <View style={{ height: GRID_GAP }} />;
}

function FeedSkeleton({
  channelType,
  tileSize,
}: {
  channelType: SpaceFeedType;
  tileSize: number;
}) {
  if (channelType === "media") {
    return (
      <View className="flex-row flex-wrap" style={{ gap: GRID_GAP }}>
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="rounded-lg" style={{ width: tileSize, height: tileSize }} />
        ))}
      </View>
    );
  }
  if (channelType === "music") {
    return (
      <View className="gap-2.5">
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} className="flex-row items-center gap-3 rounded-xl bg-card p-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </View>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View className="gap-2.5">
      {Array.from({ length: 5 }, (_, i) => (
        <NoteCardSkeleton key={i} />
      ))}
    </View>
  );
}
