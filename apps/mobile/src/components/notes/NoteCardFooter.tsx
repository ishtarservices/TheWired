import { memo } from "react";
import { Heart, MessageCircle, Repeat2, Share2, Zap } from "lucide-react-native";
import { Pressable, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { Type } from "@/components/ui/Type";
import { useNoteEngagement } from "@/components/notes/useNoteEngagement";
import { useTheme } from "@/theme/ThemeContext";

// The note action row — reply · repost · like · zap · share in the quiet
// mono register: muted 15px icons, tabular meta counts (hidden at 0), no
// fills or pills. Active states use heading ink (the monochrome signal
// language), never a chroma accent. This leaf calls useNoteEngagement itself
// so live count churn re-renders ONLY this memo boundary, not the card
// (desktop engagement-storm lesson).

export interface NoteFooterHandlers {
  reply(event: NostrEvent): void;
  repost(event: NostrEvent): void;
  like(event: NostrEvent): void;
  zap(event: NostrEvent): void;
  share(event: NostrEvent): void;
}

function count(n: number): string | null {
  if (n <= 0) return null;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export const NoteCardFooter = memo(function NoteCardFooter({
  event,
  handlers,
}: {
  event: NostrEvent;
  handlers: NoteFooterHandlers;
}) {
  const { tokens } = useTheme();
  const { replyCount, reactionCount, repostCount, zapMsat, zapCount, liked, reposted } =
    useNoteEngagement(event.id);

  const sats = Math.round(zapMsat / 1000);

  return (
    <View className="mt-2.5 flex-row items-center gap-7">
      <FooterAction
        icon={
          <MessageCircle size={15} color={tokens.muted} strokeWidth={1.75} />
        }
        label={`Reply${replyCount ? `, ${replyCount} replies` : ""}`}
        countText={count(replyCount)}
        countClass="text-muted"
        onPress={() => handlers.reply(event)}
      />
      <FooterAction
        icon={
          <Repeat2
            size={15}
            color={reposted ? tokens.heading : tokens.muted}
            strokeWidth={reposted ? 2 : 1.75}
          />
        }
        label={`Repost${repostCount ? `, ${repostCount} reposts` : ""}`}
        countText={count(repostCount)}
        countClass={reposted ? "text-heading" : "text-muted"}
        selected={reposted}
        onPress={() => handlers.repost(event)}
      />
      <FooterAction
        icon={
          <Heart
            size={15}
            color={liked ? tokens.heading : tokens.muted}
            fill={liked ? tokens.heading : "none"}
            strokeWidth={1.75}
          />
        }
        label={`Like${reactionCount ? `, ${reactionCount} likes` : ""}`}
        countText={count(reactionCount)}
        countClass={liked ? "text-heading" : "text-muted"}
        selected={liked}
        onPress={() => handlers.like(event)}
      />
      <FooterAction
        icon={<Zap size={15} color={tokens.muted} strokeWidth={1.75} />}
        label={`Zap${zapCount ? `, ${sats} sats` : ""}`}
        countText={sats > 0 ? `${count(sats)} sats` : null}
        countClass="text-muted"
        onPress={() => handlers.zap(event)}
      />
      <View className="ml-auto">
        <FooterAction
          icon={<Share2 size={15} color={tokens.muted} strokeWidth={1.75} />}
          label="Share"
          countText={null}
          countClass="text-muted"
          onPress={() => handlers.share(event)}
        />
      </View>
    </View>
  );
});

function FooterAction({
  icon,
  label,
  countText,
  countClass,
  selected,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  countText: string | null;
  countClass: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      hitSlop={10}
      className="flex-row items-center gap-1.5 py-1 active:opacity-70"
      onPress={onPress}
    >
      {icon}
      {countText ? (
        <Type role="meta" tabular className={countClass}>
          {countText}
        </Type>
      ) : null}
    </Pressable>
  );
}
