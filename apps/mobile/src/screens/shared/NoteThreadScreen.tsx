import { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessagesSquare } from "lucide-react-native";
import { FlatList, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { useScreenInsets } from "@/components/layout/Screen";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import type { RootStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";

// Note thread (W3): root event + direct replies (#e tag), live-fetched.
// Replies referencing other events as their immediate parent still show —
// full reply-tree threading ports with the shared core; this is the
// deep-link + tap-through surface.

type Props = NativeStackScreenProps<RootStackParamList, "NoteThread">;

export function NoteThreadScreen({ route, navigation }: Props) {
  const { noteId } = route.params;
  const engine = useEngine();
  const insets = useScreenInsets({ scroll: true });
  const noteActions = useNoteActions();
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const cachedRoot = useAppSelector((s) => s.feed.entities[noteId]);

  const [root, setRoot] = useState<NostrEvent | null>(cachedRoot ?? null);
  const [replies, setReplies] = useState<NostrEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!cachedRoot) {
      engine
        .fetchEvents([{ ids: [noteId] }])
        .then((events) => {
          if (!cancelled && events.length > 0) setRoot(events[0]);
          else if (!cancelled) setRoot(null);
        })
        .catch(() => {});
    }

    engine
      .fetchEvents([{ kinds: [1], "#e": [noteId], limit: 100 }])
      .then((events) => {
        if (cancelled) return;
        setReplies(events.sort((a, b) => a.created_at - b.created_at));
      })
      .catch(() => !cancelled && setReplies([]));

    // Zap receipts for the root — the engine folds them into zapsSlice, which
    // the NoteCard footer renders (W6: counts update when receipts are seen).
    engine.fetchEvents([{ kinds: [9735], "#e": [noteId], limit: 100 }]).catch(() => {});

    // Backfill authors for names/avatars once replies land.
    return () => {
      cancelled = true;
    };
  }, [engine, noteId, cachedRoot]);

  useEffect(() => {
    const authors = new Set<string>();
    if (root) authors.add(root.pubkey);
    for (const reply of replies ?? []) authors.add(reply.pubkey);
    if (authors.size > 0) engine.requestProfiles([...authors]);
  }, [engine, root, replies]);

  const visibleReplies = useMemo(
    () => (replies ?? []).filter((reply) => !muted[reply.pubkey]),
    [replies, muted],
  );

  const renderReply = useCallback(
    ({ item }: { item: NostrEvent }) => (
      <NoteCard
        event={item}
        onPress={() => navigation.push("NoteThread", { noteId: item.id })}
        onLongPress={() => noteActions.open(item)}
      />
    ),
    [navigation, noteActions],
  );

  const rootHidden = root && muted[root.pubkey];

  const header = (
    <View>
      {root ? (
        rootHidden ? (
          <View className="rounded-xl bg-card p-5">
            <Type role="caption" className="text-center text-muted">
              Note from a blocked user
            </Type>
          </View>
        ) : (
          <NoteCard event={root} onLongPress={() => root && noteActions.open(root)} />
        )
      ) : replies === null ? (
        <NoteCardSkeleton />
      ) : (
        <View className="rounded-xl bg-card p-5">
          <Type role="caption" className="text-center text-muted">
            The root note wasn't found on the connected relays.
          </Type>
        </View>
      )}
      <SectionHeader
        label={
          replies === null
            ? "replies"
            : `replies · ${visibleReplies.length}`
        }
        className="px-1"
      />
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={visibleReplies}
        keyExtractor={(item) => item.id}
        renderItem={renderReply}
        ListHeaderComponent={header}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={ReplySeparator}
        ListEmptyComponent={
          replies === null ? (
            <View className="gap-2.5">
              <NoteCardSkeleton />
              <NoteCardSkeleton />
            </View>
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No replies yet"
              message="Replies from the connected relays appear here."
            />
          )
        }
      />
      {noteActions.sheet}
    </View>
  );
}

function ReplySeparator() {
  return <View className="h-2.5" />;
}
