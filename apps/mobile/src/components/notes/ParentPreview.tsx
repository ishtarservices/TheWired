import { memo, useEffect, useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, View } from "react-native";

import { useEmbeddedEvent } from "@/components/content/useEmbeddedEvent";
import { NoteTimestamp } from "@/components/notes/NoteTimestamp";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { splitNoteContent } from "@/lib/nostr/noteContent";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { openThread } from "@/navigation/openThread";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Feed upgrade of the bare "↩ replying to a thread" meta line: the parent
// renders as a FLAT row above the reply with a vertical thread-connector
// line running from the parent's avatar down toward the reply author's
// avatar. The connector is the reply/quote disambiguator — a connected line
// reads as CONVERSATION, while a hairline-bordered card (EmbeddedNoteCard)
// reads as QUOTATION. Renders ABOVE the NoteCard header (the rail aligns
// with the 38pt avatar column). Resolution via the embed machinery (feed
// cache → module LRU → one-shot fetch); its own memo'd leaf, so resolution
// churn never re-renders the host card.

/** Matches NoteCard's avatar column (size 38 + row gap-3). */
const RAIL_WIDTH = 38;

export interface ParentPreviewProps {
  parentId: string;
  rootId: string;
}

export const ParentPreview = memo(function ParentPreview({
  parentId,
  rootId,
}: ParentPreviewProps) {
  const { tokens } = useTheme();
  const navigation = useNavigation();
  const engine = useEngine();
  const ref = useMemo(() => ({ type: "event-ref" as const, id: parentId }), [parentId]);
  const { event, loading } = useEmbeddedEvent(ref);

  const mutedAuthor = useAppSelector((s) =>
    event ? s.moderation.mutedPubkeys[event.pubkey] === true : false,
  );
  const profile = useAppSelector((s) =>
    event ? s.profiles.byPubkey[event.pubkey] : undefined,
  );
  const authorPubkey = event?.pubkey;
  useEffect(() => {
    if (authorPubkey) engine.requestProfiles([authorPubkey]);
  }, [engine, authorPubkey]);

  const open = () => openThread(navigation, { noteId: parentId, rootId });

  const rail = (
    <View style={{ width: RAIL_WIDTH, alignItems: "center" }}>
      {loading ? (
        <SkeletonCircle size={20} />
      ) : (
        <Avatar
          uri={profile?.picture}
          name={event ? profileDisplayName(profile, event.pubkey) : "?"}
          pubkey={event?.pubkey ?? parentId}
          size={20}
        />
      )}
      <View
        style={{
          flex: 1,
          width: StyleSheet.hairlineWidth * 2,
          minHeight: 10,
          marginTop: 4,
          backgroundColor: tokens.borderLight,
        }}
      />
    </View>
  );

  if (loading) {
    return (
      <View className="flex-row gap-3 pb-2">
        {rail}
        <View className="flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-1.5 h-3 w-4/5" />
        </View>
      </View>
    );
  }

  if (!event || mutedAuthor) {
    // Unresolvable (foreign relay, deleted) or blocked — keep the affordance.
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="View the thread this reply belongs to"
        hitSlop={6}
        onPress={open}
      >
        <Type role="meta" className="mb-1.5 text-muted">
          ↩ replying to a thread
        </Type>
      </Pressable>
    );
  }

  const name = profileDisplayName(profile, event.pubkey);
  const text = splitNoteContent(event.content).text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View the note by ${name} this replies to`}
      onPress={open}
      className="flex-row gap-3 pb-2 active:bg-surface-hover"
    >
      {rail}
      <View className="flex-1">
        <View className="flex-row items-baseline gap-2">
          <Type role="caption" weight={600} className="shrink text-muted" numberOfLines={1}>
            {name}
          </Type>
          <NoteTimestamp createdAt={event.created_at} />
        </View>
        <Type role="caption" className="mt-0.5 text-muted" numberOfLines={2}>
          {text || "media post"}
        </Type>
      </View>
    </Pressable>
  );
});
