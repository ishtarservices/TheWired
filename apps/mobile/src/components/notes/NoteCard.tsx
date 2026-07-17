import { memo, useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import { Zap as ZapIcon } from "lucide-react-native";
import { Image, Pressable, StyleSheet, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteText } from "@/components/content/NoteText";
import { NoteCardFooter, type NoteFooterHandlers } from "@/components/notes/NoteCardFooter";
import { NoteTimestamp } from "@/components/notes/NoteTimestamp";
import { ParentPreview } from "@/components/notes/ParentPreview";
import { ReplyPeek } from "@/components/notes/ReplyPeek";
import { Avatar } from "@/components/ui/Avatar";
import { SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { splitNoteContent } from "@/lib/nostr/noteContent";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { openThread } from "@/navigation/openThread";
import { useAppSelector } from "@/store/hooks";
import { selectFeedEvent } from "@/store/slices/feedSlice";
import { useTheme } from "@/theme/ThemeContext";

// The feed's unit of content — a flat editorial row (signal pass), not a
// tonal card: notes sit directly on the canvas, separated by hairlines, so
// the feed reads as one continuous surface instead of grey slabs. Rows own
// their padding + divider; parents render them full-bleed (no container
// horizontal padding, no separators). Timestamps and receipts speak the
// protocol voice (meta role).

export interface NoteCardProps {
  event: NostrEvent;
  /** Called with the note — pass STABLE callbacks so the memo holds under
   *  live-feed churn (inline arrows here defeat it; measured 23×/150s). */
  onPress?: (event: NostrEvent) => void;
  onLongPress?: (event: NostrEvent) => void;
  /** Action row (reply · repost · like · zap · share). Absent = the legacy
   *  zap-receipt line only. Engagement selectors live in the footer leaf, so
   *  count churn never re-renders the card. */
  footer?: NoteFooterHandlers;
  /** Feed surfaces: upgrade the "↩ replying to" line into a compact parent
   *  card. Stable primitive — memo-safe. Off in thread rows (the tree shows
   *  structure) and other surfaces. */
  parentPreview?: boolean;
  /** Feed surfaces: inline reply peek under the footer ("view replies · N").
   *  Stable primitive — memo-safe; all peek state lives in the leaf. */
  peek?: boolean;
}

export const NoteCard = memo(function NoteCard({
  event,
  onPress,
  onLongPress,
  footer,
  parentPreview,
  peek,
}: NoteCardProps) {
  const navigation = useNavigation();
  const { tokens } = useTheme();
  const profile = useAppSelector((s) => s.profiles.byPubkey[event.pubkey]);
  const { text, images } = useMemo(() => splitNoteContent(event.content), [event.content]);
  const name = profileDisplayName(profile, event.pubkey);

  // NIP-10: a reply carries a tappable "replying to" line — the jump to the
  // conversation it belongs to, anchored on the immediate parent (so this
  // note is guaranteed to appear there). Parent name resolves
  // opportunistically from the feed cache; no extra relay traffic for a
  // meta line.
  const { parentId, rootId } = useMemo(() => {
    const ref = parseThreadRef(event);
    return { parentId: ref.replyId ?? ref.rootId, rootId: ref.rootId };
  }, [event]);
  const parentEvent = useAppSelector((s) =>
    parentId ? selectFeedEvent(s, parentId) : undefined,
  );
  const parentProfile = useAppSelector((s) =>
    parentEvent ? s.profiles.byPubkey[parentEvent.pubkey] : undefined,
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress ? () => onPress(event) : undefined}
      onLongPress={onLongPress ? () => onLongPress(event) : undefined}
      delayLongPress={300}
      className="px-4 py-3.5 active:bg-surface-hover"
      style={{
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: tokens.borderLight,
      }}
    >
      {/* Feed surfaces: the parent renders ABOVE the header as a flat row —
          its rail (20pt avatar + vertical connector) aligns with the 38pt
          avatar column below, so the line reads "this replies to that".
          Bordered cards are reserved for quotes (EmbeddedNoteCard). */}
      {parentId && parentPreview ? (
        <ParentPreview parentId={parentId} rootId={rootId ?? parentId} />
      ) : null}

      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}'s profile`}
          onPress={() => navigation.navigate("Profile", { pubkey: event.pubkey })}
          hitSlop={6}
        >
          <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={38} />
        </Pressable>
        <View className="flex-1 flex-row items-baseline gap-2">
          <Type role="body" weight={600} className="shrink text-heading" numberOfLines={1}>
            {name}
          </Type>
          <NoteTimestamp createdAt={event.created_at} />
        </View>
      </View>

      {parentId && !parentPreview ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="View the thread this reply belongs to"
          hitSlop={6}
          onPress={() =>
            openThread(navigation, { noteId: parentId, rootId: rootId ?? parentId })
          }
        >
          <Type role="meta" className="mt-1.5 text-muted">
            ↩ replying to{" "}
            {parentEvent
              ? `@${profileDisplayName(parentProfile, parentEvent.pubkey)}`
              : "a thread"}
          </Type>
        </Pressable>
      ) : null}

      {text ? (
        <NoteText
          content={text}
          numberOfLines={12}
          containerClassName="mt-2"
          textClassName="leading-[22px] text-body"
        />
      ) : null}

      {images.length > 0 ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel="Open image"
          className="mt-3 overflow-hidden rounded-xl"
          style={{
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: tokens.borderLight,
            backgroundColor: tokens.surface,
          }}
          onPress={() => navigation.navigate("MediaLightbox", { srcs: images, startIndex: 0 })}
        >
          <Image
            source={{ uri: images[0] }}
            className="h-52 w-full"
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
          {images.length > 1 ? (
            // Literal black scrim — sits on the image, not on a themed surface.
            <View className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5">
              <Type role="meta" className="text-white">
                +{images.length - 1}
              </Type>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {footer ? (
        <NoteCardFooter event={event} handlers={footer} />
      ) : (
        <ZapLine eventId={event.id} />
      )}

      {peek ? <ReplyPeek event={event} /> : null}
    </Pressable>
  );
});

/** Legacy zap-receipt line for surfaces without the action row — its own
 *  memo'd leaf so the zap selector never re-renders the card. */
const ZapLine = memo(function ZapLine({ eventId }: { eventId: string }) {
  const { tokens } = useTheme();
  const zaps = useAppSelector((s) => s.zaps.byEvent[eventId]);
  if (!zaps || zaps.count === 0) return null;
  return (
    <View className="mt-2.5 flex-row items-center gap-1.5">
      <ZapIcon size={11} color={tokens.muted} strokeWidth={1.75} />
      <Type role="meta" tabular className="text-muted">
        {Math.round(zaps.msat / 1000).toLocaleString()} sats
        {zaps.count > 1 ? ` · ${zaps.count} zaps` : ""}
      </Type>
    </View>
  );
});

/** Content-shaped loading stand-in — same flat-row geometry as NoteCard. */
export function NoteCardSkeleton() {
  return (
    <View className="px-4 py-3.5">
      <View className="flex-row items-center gap-3">
        <SkeletonCircle size={38} />
        <View className="flex-1 gap-1.5">
          <View className="w-32">
            <SkeletonText lines={1} />
          </View>
        </View>
      </View>
      <SkeletonText lines={2} className="mt-3" />
    </View>
  );
}
