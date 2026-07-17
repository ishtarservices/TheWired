// Store-connected, memoized chat message row. ChannelScreen must NOT select
// the whole profiles.byPubkey map — kind-0 backfill runs for every chatter,
// and a whole-map subscription re-rendered the entire chat list on every
// profile arrival. Each row selects exactly its sender's profile (the
// ChannelRowConnected discipline), so a kind-0 re-renders only that author's
// rows. Handlers passed in must be stable (W9 contract).

import { memo } from "react";
import { Pressable, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteText } from "@/components/content/NoteText";
import { Avatar } from "@/components/ui/Avatar";
import { Type } from "@/components/ui/Type";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import { timeLabel } from "../chatRows";

export const ChatMessageRow = memo(function ChatMessageRow({
  event,
  grouped,
  onLongPress,
  onPressAuthor,
}: {
  event: NostrEvent;
  /** Continuation of the author's run — render without avatar/name header. */
  grouped: boolean;
  onLongPress: (event: NostrEvent) => void;
  onPressAuthor: (pubkey: string) => void;
}) {
  const profile = useAppSelector((s) => s.profiles.byPubkey[event.pubkey]);
  const name = profileDisplayName(profile, event.pubkey);

  if (grouped) {
    // Content only, aligned with the name column (36pt avatar + 12pt gap).
    return (
      <Pressable
        accessibilityRole="button"
        onLongPress={() => onLongPress(event)}
        delayLongPress={300}
        className="px-4 py-0.5"
      >
        <View style={{ marginLeft: 48 }}>
          <NoteText content={event.content} textClassName="leading-5 text-soft" />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onLongPress={() => onLongPress(event)}
      delayLongPress={300}
      className="flex-row gap-3 px-4 pb-0.5 pt-2.5"
    >
      <Pressable accessibilityRole="button" onPress={() => onPressAuthor(event.pubkey)}>
        <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={36} />
      </Pressable>
      <View className="flex-1">
        <View className="flex-row items-baseline gap-2">
          <Type role="caption" weight={600} className="text-heading" numberOfLines={1}>
            {name}
          </Type>
          <Type role="micro" tabular className="text-faint">
            {timeLabel(event.created_at)}
          </Type>
        </View>
        <NoteText
          content={event.content}
          containerClassName="mt-0.5"
          textClassName="leading-5 text-soft"
        />
      </View>
    </Pressable>
  );
});
