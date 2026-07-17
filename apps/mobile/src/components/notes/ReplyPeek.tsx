import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { compareEventsChrono, isDirectReply, isQuoteOnly } from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

import { CompactNoteRow } from "@/components/notes/CompactNoteRow";
import { rankPeekReplies } from "@/components/notes/peekRank";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { useOpenThread } from "@/navigation/openThread";
import { useAppDispatch, useAppSelector, useAppStore } from "@/store/hooks";
import { selectReplyCount } from "@/store/slices/engagementSlice";
import { threadEventsMerged } from "@/store/slices/threadsSlice";
import { useTheme } from "@/theme/ThemeContext";

// Inline conversation peek under a feed card: "view replies · N" expands the
// top direct replies in place (no navigation); "view all" opens the thread.
// The expand fetch seeds the thread cache, so "view all" renders instantly.
// All state lives in this memo'd leaf — expansion never touches FlatList
// data (freeze contract) and count churn never re-renders the host card.
// Far-scrolled cells unmount and lose peek state (windowSize) — re-expanding
// costs one deduped fetch; acceptable for ephemeral UI.

/** Fetch head for the peek — plenty to find 3 direct replies. */
const PEEK_FETCH_LIMIT = 20;
const PEEK_MAX_ROWS = 3;

export const ReplyPeek = memo(function ReplyPeek({ event }: { event: NostrEvent }) {
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const openThread = useOpenThread();
  const { tokens } = useTheme();
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const replyCount = useAppSelector((s) => selectReplyCount(s, event.id));

  const [phase, setPhase] = useState<"collapsed" | "loading" | "open">("collapsed");
  const [replies, setReplies] = useState<NostrEvent[]>([]);

  const rootId = useMemo(() => parseThreadRef(event).rootId ?? event.id, [event]);

  const expand = useCallback(async () => {
    setPhase("loading");
    try {
      const fetched = await engine.fetchEvents([
        { kinds: [1], "#e": [event.id], limit: PEEK_FETCH_LIMIT },
      ]);
      const direct = fetched
        .filter((e) => e.kind === 1 && isDirectReply(e, event.id) && !isQuoteOnly(e))
        .sort(compareEventsChrono);
      // Seed the thread cache (anchor + replies) — "view all" and reply
      // taps render from it with no fetch.
      dispatch(threadEventsMerged({ rootId, events: [event, ...direct] }));

      if (direct.length > PEEK_MAX_ROWS) {
        // More candidates than rows: fetch their engagement (folds into the
        // aggregate slices via routeEvent) and surface the most-substantive
        // openers instead of just the earliest.
        await engine
          .fetchEvents([{ kinds: [7, 6, 9735], "#e": direct.map((e) => e.id), limit: 100 }])
          .catch(() => {});
        const s = store.getState();
        const scoreOf = (id: string): number =>
          Object.keys(s.engagement.reactionsByTarget[id] ?? {}).length +
          Object.keys(s.engagement.repostsByTarget[id] ?? {}).length +
          (s.engagement.repliesByTarget[id]?.length ?? 0) +
          (s.zaps.byEvent[id]?.count ?? 0);
        setReplies(rankPeekReplies(direct, scoreOf));
      } else {
        setReplies(direct);
      }
      setPhase("open");
    } catch {
      setPhase("collapsed");
    }
  }, [engine, dispatch, store, event, rootId]);

  const collapse = useCallback(() => setPhase("collapsed"), []);
  const openReply = useCallback(
    (reply: NostrEvent) => openThread({ noteId: reply.id, rootId }),
    [openThread, rootId],
  );
  const openAll = useCallback(
    () => openThread({ noteId: event.id, rootId }),
    [openThread, event.id, rootId],
  );

  if (replyCount <= 0 && phase === "collapsed") return null;

  if (phase === "collapsed") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${replyCount} ${replyCount === 1 ? "reply" : "replies"}`}
        hitSlop={6}
        onPress={expand}
      >
        <Type role="meta" className="mt-2.5 text-muted">
          view replies · {replyCount}
        </Type>
      </Pressable>
    );
  }

  if (phase === "loading") {
    return (
      <Type role="meta" className="mt-2.5 text-faint">
        loading replies…
      </Type>
    );
  }

  const visible = replies.filter((reply) => !muted[reply.pubkey]).slice(0, PEEK_MAX_ROWS);
  return (
    <View
      className="mt-2.5 rounded-xl"
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.borderLight }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide replies"
        onPress={collapse}
        className="px-3 pt-2"
      >
        <Type role="micro" className="text-faint">
          replies · hide
        </Type>
      </Pressable>
      {visible.length > 0 ? (
        visible.map((reply) => (
          <CompactNoteRow key={reply.id} event={reply} onPress={openReply} />
        ))
      ) : (
        <Type role="meta" className="px-3 py-2 text-faint">
          no replies found on the connected relays
        </Type>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View all ${replyCount} replies`}
        onPress={openAll}
        className="px-3 pb-2.5 pt-1 active:bg-surface-hover"
      >
        <Type role="meta" className="text-primary">
          view all {replyCount} {replyCount === 1 ? "reply" : "replies"} →
        </Type>
      </Pressable>
    </View>
  );
});
