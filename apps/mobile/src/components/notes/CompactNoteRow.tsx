import { memo, useEffect, useMemo } from "react";
import { Pressable, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { NoteTimestamp } from "@/components/notes/NoteTimestamp";
import { Avatar } from "@/components/ui/Avatar";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { splitNoteContent } from "@/lib/nostr/noteContent";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";

// Compact one-glance note row — ancestor context in the thread view (and the
// reply-peek rows later). Flat like NoteCard (no card frame): author line +
// two clamped text lines. Same stable-callback contract as NoteCard: pass a
// memoized onPress or the memo is defeated.

export interface CompactNoteRowProps {
  event: NostrEvent;
  /** Small right-aligned badge — "root" on the conversation root. */
  badge?: string;
  onPress?: (event: NostrEvent) => void;
}

export const CompactNoteRow = memo(function CompactNoteRow({
  event,
  badge,
  onPress,
}: CompactNoteRowProps) {
  const engine = useEngine();
  const profile = useAppSelector((s) => s.profiles.byPubkey[event.pubkey]);
  useEffect(() => {
    engine.requestProfiles([event.pubkey]);
  }, [engine, event.pubkey]);

  const name = profileDisplayName(profile, event.pubkey);
  // Image URLs read as noise in a two-line preview — drop them.
  const text = useMemo(() => splitNoteContent(event.content).text, [event.content]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View note by ${name}`}
      onPress={onPress ? () => onPress(event) : undefined}
      className="px-4 py-2.5 active:bg-surface-hover"
    >
      <View className="flex-row items-center gap-2">
        <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={20} />
        <Type role="caption" weight={600} className="shrink text-heading" numberOfLines={1}>
          {name}
        </Type>
        <NoteTimestamp createdAt={event.created_at} />
        {badge ? (
          <Type role="micro" className="ml-auto text-faint">
            {badge}
          </Type>
        ) : null}
      </View>
      <Type role="caption" className="mt-1 text-muted" numberOfLines={2}>
        {text || "media post"}
      </Type>
    </Pressable>
  );
});
