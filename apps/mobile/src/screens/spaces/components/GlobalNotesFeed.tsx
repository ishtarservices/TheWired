import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Antenna, ArrowUp, KeyRound, PenLine, UsersRound } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, View, type ViewToken } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NewNotesPill } from "@/components/notes/NewNotesPill";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useEngine } from "@/lib/nostr/EngineContext";
import { EngagementWindow } from "@/lib/nostr/engagementWindow";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { haptics } from "@/lib/haptics";
import { openThread as openThreadNav } from "@/navigation/openThread";
import { getStoredFeedScope, storeFeedScope } from "@/platform/appPrefs";
import { countFreshEvents, useFeedFreeze } from "@/screens/spaces/feedFreeze";
import { parseFeedScope } from "@/screens/spaces/feedScope";
import { FeedScopeToggle } from "@/screens/spaces/components/FeedScopeToggle";
import { SHADOWS } from "@/theme/constants";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";
import { useAppSelector } from "@/store/hooks";
import {
  selectActiveFeed,
  selectFeedContext,
  type FeedContext,
} from "@/store/slices/feedSlice";

// The live notes feed — the Spaces home's "feed" pane (guest-visible live
// surface, W2 exit criterion), split into global/follows scopes. Compose FAB
// gates at the action inside the composer (5.1.1(v)); the follows tab gates
// with an inline affordance so the screen stays guest-browsable.
//
// Live traffic must never yank the viewport: while the user is scrolled into
// the feed the rows render a frozen snapshot (feedFreeze.ts) and new notes
// surface via the pill; pinned at top, batches merge live with
// maintainVisibleContentPosition as belt-and-braces for in-flight prepends.

/** Session memory for the stored scope — read storage once per app run. */
let bootScope: FeedContext | null | undefined;

/** Imperative surface for SpacesHome's tab re-press → scroll-to-top bridge. */
export interface GlobalNotesFeedHandle {
  scrollToTop(): void;
}

interface GlobalNotesFeedProps {
  paddingTop: number;
  paddingBottom: number;
}

export const GlobalNotesFeed = forwardRef<GlobalNotesFeedHandle, GlobalNotesFeedProps>(
  function GlobalNotesFeed({ paddingTop, paddingBottom }, ref) {
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const motion = useMotion();
  const noteActions = useNoteActions();
  const listRef = useRef<FlatList<NostrEvent>>(null);

  const context = useAppSelector(selectFeedContext);
  const ids = useAppSelector((s) => selectActiveFeed(s).ids);
  const entities = useAppSelector((s) => selectActiveFeed(s).entities);
  const status = useAppSelector((s) => selectActiveFeed(s).status);
  const followsStatus = useAppSelector((s) => s.follows.status);
  const followsCount = useAppSelector((s) => s.follows.pubkeys.length);
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const [refreshing, setRefreshing] = useState(false);

  // Restore the persisted scope once per app run (engine boots on global).
  useEffect(() => {
    if (bootScope !== undefined) return;
    bootScope = null;
    getStoredFeedScope().then((raw) => {
      const stored = parseFeedScope(raw);
      bootScope = stored;
      if (stored === "follows") engine.setFeedContext(stored);
    });
  }, [engine]);

  const live = useMemo(() => ids.map((id) => entities[id]).filter(Boolean), [ids, entities]);
  const { frozen, scrolledDeep, unfreeze, freezeIfScrolled, handlers } = useFeedFreeze(live);

  // Muted filter applies to BOTH paths — muting someone mid-freeze removes
  // them from the frozen view too. `source` keeps its identity while frozen,
  // so `events` (the FlatList data) stays referentially stable and rows
  // memo-hit even as live batches keep landing (measured: without this every
  // mounted card re-rendered per 50ms flush).
  const source = frozen ?? live;
  const events = useMemo(() => source.filter((e) => !muted[e.pubkey]), [source, muted]);
  const frozenIds = useMemo(
    () => (frozen ? new Set(frozen.map((e) => e.id)) : null),
    [frozen],
  );
  const freshCount = frozenIds ? countFreshEvents(live, frozenIds, muted) : 0;

  // Backfill missing kind-0s for visible authors (engine dedupes in-flight).
  const authorsKey = useMemo(
    () => [...new Set(events.map((e) => e.pubkey))].sort().join(","),
    [events],
  );
  useEffect(() => {
    if (authorsKey) engine.requestProfiles(authorsKey.split(","));
  }, [engine, authorsKey]);

  // Leaving the screen (push into a thread/profile, tab switch) PINS the
  // rows: capture the snapshot if reading mid-feed, so back-nav restores the
  // exact position with identical data. (The old unfreeze-on-blur swapped in
  // the live array — everything that arrived while reading shifted the
  // restored offset.) The pill counts what accumulated; scroll-to-top,
  // refresh, and scope change still unfreeze.
  useFocusEffect(useCallback(() => () => freezeIfScrolled(), [freezeIfScrolled]));

  // Viewport-windowed engagement: cards report visibility → 300ms debounce →
  // one 4-filter REQ per batch on a fixed sub id (desktop EngagementWindow
  // port). Data-source agnostic — reports whatever is rendered, frozen or
  // live; the fetched-set dedups across transitions.
  const windowRef = useRef<EngagementWindow | null>(null);
  if (!windowRef.current) windowRef.current = new EngagementWindow(engine);
  useEffect(() => () => windowRef.current?.dispose(), []);
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 1 },
      onViewableItemsChanged: ({ changed }: { changed: ViewToken[] }) => {
        for (const token of changed) {
          const item = token.item as NostrEvent | undefined;
          if (item?.id) windowRef.current?.report(item.id, token.index ?? 0, token.isViewable);
        }
      },
    },
  ]).current;

  const scrollToTop = useCallback(() => {
    unfreeze();
    listRef.current?.scrollToOffset({ offset: 0, animated: !motion.reducedMotion });
  }, [unfreeze, motion.reducedMotion]);

  useImperativeHandle(ref, () => ({ scrollToTop }), [scrollToTop]);

  const onScopeChange = useCallback(
    (next: FeedContext) => {
      storeFeedScope(next);
      unfreeze();
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      engine.setFeedContext(next);
    },
    [engine, unfreeze],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.selection();
    unfreeze();
    engine.refreshFeed().finally(() => setRefreshing(false));
  }, [engine, unfreeze]);

  // Stable per-event callbacks — inline arrows in renderItem defeat
  // NoteCard's memo on every cell pass.
  const openThread = useCallback(
    (note: NostrEvent) =>
      openThreadNav(rootNavigation, {
        noteId: note.id,
        rootId: parseThreadRef(note).rootId ?? note.id,
      }),
    [rootNavigation],
  );
  const openActions = noteActions.open;

  const renderNote = useCallback(
    ({ item }: { item: NostrEvent }) => (
      <NoteCard
        event={item}
        onPress={openThread}
        onLongPress={openActions}
        footer={noteActions.footer}
        parentPreview
        peek
      />
    ),
    [openThread, openActions, noteActions.footer],
  );

  const showSkeletons = events.length === 0 && status !== "live";

  // Honest follows empty states — never a spinner with nothing behind it.
  const followsEmpty = () => {
    if (!isLoggedIn) {
      return (
        <EmptyState
          icon={KeyRound}
          title="Follows needs your key"
          message="Log in to see notes from people you follow."
          action={
            <Button variant="secondary" onPress={() => rootNavigation.navigate("Login")}>
              Log in
            </Button>
          }
        />
      );
    }
    if (followsStatus === "missing") {
      return (
        <EmptyState
          icon={UsersRound}
          title="No follow list found"
          message="Your relays didn't return a follow list for this key."
          action={
            <Button variant="secondary" onPress={() => void engine.refreshFollows().catch(() => {})}>
              Retry
            </Button>
          }
        />
      );
    }
    if (followsStatus === "ready" && followsCount === 0) {
      return (
        <EmptyState
          icon={UsersRound}
          title="You don't follow anyone yet"
          message="Notes from people you follow will appear here."
        />
      );
    }
    if (followsStatus === "ready" && status === "live") {
      return (
        <EmptyState
          icon={Antenna}
          title="Nothing from your follows yet"
          message="Their notes appear here as relays respond."
        />
      );
    }
    // idle/loading (kind-3 fetch or backfill in flight) — content-shaped wait.
    return (
      <View>
        {Array.from({ length: 6 }, (_, i) => (
          <NoteCardSkeleton key={i} />
        ))}
      </View>
    );
  };

  return (
    <View className="flex-1" style={{ paddingTop }}>
      <FeedScopeToggle scope={context} onChange={onScopeChange} />

      <View className="flex-1">
        <FlatList
          ref={listRef}
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={renderNote}
          // Flat editorial rows: NoteCard owns padding + hairline divider —
          // the list is full-bleed with no gap separators.
          contentContainerStyle={{
            paddingTop: 4,
            paddingBottom: paddingBottom + 88,
          }}
          {...handlers}
          scrollEventThrottle={16}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          viewabilityConfigCallbackPairs={viewabilityPairs}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.muted} />
          }
          ListEmptyComponent={
            context === "follows" ? (
              followsEmpty()
            ) : showSkeletons ? (
              <View>
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

        {frozen && freshCount > 0 ? (
          <NewNotesPill count={freshCount} topOffset={8} onPress={scrollToTop} />
        ) : null}
      </View>

      {scrolledDeep ? (
        // Back-to-top: same bordered register as the FAB, opposite corner —
        // never a second primary fill.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to top"
          onPress={() => {
            haptics.selection();
            scrollToTop();
          }}
          className="absolute left-4 h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:opacity-90"
          style={[{ bottom: paddingBottom + 16 }, SHADOWS.md]}
        >
          <ArrowUp size={18} color={tokens.soft} strokeWidth={2} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compose a note"
        onPress={() => {
          haptics.tap();
          rootNavigation.navigate("Composer", { mode: "note" });
        }}
        // Bordered surface, not a primary fill — on this tab root the tab
        // bar's active circle is the screen's one inversion.
        className="absolute right-4 h-14 w-14 items-center justify-center rounded-full border border-border bg-card active:opacity-90"
        style={[{ bottom: paddingBottom + 16 }, SHADOWS.lg]}
      >
        <PenLine size={22} color={tokens.heading} strokeWidth={2} />
      </Pressable>

      {noteActions.sheet}
    </View>
  );
});
