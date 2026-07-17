import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessagesSquare } from "lucide-react-native";
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from "react-native";
import { ANCESTORS_EXPANDED_KEY, flattenThread, type ThreadRow } from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

import { useScreenInsets } from "@/components/layout/Screen";
import { CompactNoteRow } from "@/components/notes/CompactNoteRow";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { EngagementWindow } from "@/lib/nostr/engagementWindow";
import type { RootStackParamList } from "@/navigation/types";
import { useOpenThread } from "@/navigation/openThread";
import { useAppSelector } from "@/store/hooks";
import { THREAD_EVENTS_CAP } from "@/store/slices/threadsSlice";
import { useTheme } from "@/theme/ThemeContext";
import { useThread } from "./useThread";

// Anchored conversation view: a bounded compact ancestor block (≤2 rows +
// gap ≈ one glance), the focused note full-size, then the reply TREE —
// indent clamped at depth 2, deeper branches collapsed behind inline
// "show N more" expanders. Everything renders from the session thread cache
// (threadsSlice, keyed by root id), so re-opening any note in a cached
// conversation paints instantly; useThread runs the SWR refresh behind it.

/** Indent per visual reply level (depth 1 sits flush like the feed). */
const REPLY_INDENT = 16;

type Props = NativeStackScreenProps<RootStackParamList, "NoteThread">;

export function NoteThreadScreen({ route }: Props) {
  const { noteId, rootId: rootIdParam } = route.params;
  const engine = useEngine();
  const insets = useScreenInsets({ scroll: true });
  const { tokens } = useTheme();
  const noteActions = useNoteActions();
  const openThread = useOpenThread();
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const { rootId, entry, events, tree, notFound } = useThread(noteId, rootIdParam);

  // Collapse state is per pushed instance (two stacked thread views keep
  // independent expansion) and survives back-gesture — native-stack keeps
  // screens mounted.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const expandAncestors = useCallback(() => onToggle(ANCESTORS_EXPANDED_KEY), [onToggle]);

  const rows = useMemo(
    () => (tree ? flattenThread(tree, { expanded, truncated: entry?.truncated }) : []),
    [tree, expanded, entry?.truncated],
  );
  const replyCount = tree?.focus?.descendants ?? 0;
  const settled = entry?.status === "ready";

  // Tapping any note in the conversation re-anchors on it — same primitive
  // as the feeds, always with the known root so the target renders from
  // this cache with no fetch.
  const openNote = useCallback(
    (event: NostrEvent) => openThread({ noteId: event.id, rootId }),
    [openThread, rootId],
  );

  const loadingOlder = entry?.loadingOlder === true;
  const atCap = events.length >= THREAD_EVENTS_CAP;
  const loadOlder = useCallback(() => {
    if (rootId) engine.loadOlderReplies(rootId).catch(() => {});
  }, [engine, rootId]);

  // Viewport-windowed engagement, same wiring as the feeds: visible rows
  // report → 300ms debounce → one 4-filter REQ. The kind-1 leg doubles as
  // the live-reply feed for this conversation (routeEvent merges arrivals
  // into the thread cache).
  const windowRef = useRef<EngagementWindow | null>(null);
  if (!windowRef.current) windowRef.current = new EngagementWindow(engine);
  useEffect(() => () => windowRef.current?.dispose(), []);
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 1 },
      onViewableItemsChanged: ({ changed }: { changed: ViewToken[] }) => {
        for (const token of changed) {
          const row = token.item as ThreadRow | undefined;
          if (row && (row.kind === "focus" || row.kind === "reply" || row.kind === "ancestor")) {
            windowRef.current?.report(row.event.id, token.index ?? 0, token.isViewable);
          }
        }
      },
    },
  ]).current;

  const renderRow = useCallback(
    ({ item }: { item: ThreadRow }) => {
      switch (item.kind) {
        case "ancestor":
          return muted[item.event.pubkey] ? (
            <MutedNoteRow compact />
          ) : (
            <CompactNoteRow
              event={item.event}
              badge={item.isRoot ? "root" : undefined}
              onPress={openNote}
            />
          );
        case "ancestor-gap":
          return (
            <GapRow
              hiddenCount={item.hiddenCount}
              unknownDepth={item.unknownDepth}
              onExpand={item.hiddenCount > 0 ? expandAncestors : undefined}
            />
          );
        case "focus":
          return (
            <View>
              {muted[item.event.pubkey] ? (
                <MutedNoteRow />
              ) : (
                <NoteCard
                  event={item.event}
                  onLongPress={noteActions.open}
                  footer={noteActions.footer}
                />
              )}
              <SectionHeader
                label={replyCount > 0 ? `replies · ${replyCount}` : "replies"}
                className="px-4"
              />
              {settled && replyCount === 0 ? (
                <Type role="meta" className="px-4 pt-1 text-muted">
                  No replies yet.
                </Type>
              ) : null}
            </View>
          );
        case "load-older":
          // Honesty row — the reply page came back full, so older replies
          // may be missing. At the per-thread cap paging is futile (merged
          // pages would evict straight back out) — say so instead.
          if (atCap) {
            return (
              <Type role="meta" className="px-4 py-2 text-faint">
                thread too large — showing the latest {THREAD_EVENTS_CAP} replies
              </Type>
            );
          }
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load older replies"
              onPress={loadingOlder ? undefined : loadOlder}
              className="px-4 py-2 active:bg-surface-hover"
            >
              <Type role="meta" className={loadingOlder ? "text-faint" : "text-primary"}>
                {loadingOlder
                  ? "loading older replies…"
                  : "older replies may be missing — load older"}
              </Type>
            </Pressable>
          );
        case "reply":
          return (
            <View
              style={
                item.depth > 1
                  ? {
                      marginLeft: (item.depth - 1) * REPLY_INDENT,
                      borderLeftWidth: StyleSheet.hairlineWidth,
                      borderLeftColor: tokens.borderLight,
                    }
                  : undefined
              }
            >
              {muted[item.event.pubkey] ? (
                <MutedNoteRow compact />
              ) : (
                <NoteCard
                  event={item.event}
                  onPress={openNote}
                  onLongPress={noteActions.open}
                  footer={noteActions.footer}
                />
              )}
            </View>
          );
        case "expander":
          return (
            <ExpanderRow
              parentId={item.parentId}
              hiddenCount={item.hiddenCount}
              depth={item.depth}
              onToggle={onToggle}
            />
          );
      }
    },
    [
      muted,
      openNote,
      expandAncestors,
      onToggle,
      noteActions.open,
      noteActions.footer,
      replyCount,
      settled,
      atCap,
      loadingOlder,
      loadOlder,
      tokens.borderLight,
    ],
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        // Ancestor-chain fill-ins from the SWR refresh insert above a
        // scrolled viewport — keep the anchor row put.
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
        }}
        ListEmptyComponent={
          notFound || settled ? (
            <EmptyState
              icon={MessagesSquare}
              title="Note unavailable"
              message="It wasn't found on the connected relays."
            />
          ) : (
            <View>
              <NoteCardSkeleton />
              <NoteCardSkeleton />
            </View>
          )
        }
      />
      {noteActions.sheet}
    </View>
  );
}

/** Collapsed/unknown links in the ancestor chain. Pressable only when there
 *  are known events to reveal (unknown depth means they were never fetched —
 *  the P4 backfill's job). */
const GapRow = ({
  hiddenCount,
  unknownDepth,
  onExpand,
}: {
  hiddenCount: number;
  unknownDepth: boolean;
  onExpand?: () => void;
}) => {
  const label =
    hiddenCount > 0
      ? `· in reply chain — ${hiddenCount} more`
      : "· earlier context unavailable";
  const body = (
    <Type role="meta" className="text-muted">
      {label}
      {unknownDepth && hiddenCount > 0 ? " (some missing)" : ""}
    </Type>
  );
  if (!onExpand) return <View className="px-4 py-1.5">{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${hiddenCount} more notes in the reply chain`}
      onPress={onExpand}
      className="px-4 py-1.5 active:bg-surface-hover"
    >
      {body}
    </Pressable>
  );
};

/** Inline "show N more replies" — expands the collapsed subtree in place. */
const ExpanderRow = ({
  parentId,
  hiddenCount,
  depth,
  onToggle,
}: {
  parentId: string;
  hiddenCount: number;
  depth: number;
  onToggle: (id: string) => void;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Show ${hiddenCount} more ${hiddenCount === 1 ? "reply" : "replies"}`}
    onPress={() => onToggle(parentId)}
    className="py-2 active:bg-surface-hover"
    style={{ paddingLeft: depth * REPLY_INDENT + 16 }}
  >
    <Type role="meta" className="text-primary">
      show {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
    </Type>
  </Pressable>
);

const MutedNoteRow = ({ compact }: { compact?: boolean }) => (
  <View className={compact ? "px-4 py-2.5" : "px-4 py-3.5"}>
    <Type role="meta" className="text-faint">
      Note from a blocked user
    </Type>
  </View>
);
