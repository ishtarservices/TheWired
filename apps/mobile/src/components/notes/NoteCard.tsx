import { memo, useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import { Zap as ZapIcon } from "lucide-react-native";
import { Image, Pressable, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { splitNoteContent } from "@/lib/nostr/noteContent";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { formatRelativeTime } from "@/lib/time";
import { useAppSelector } from "@/store/hooks";

// The feed's unit of content (W2): tonal card, avatar + name + relative
// time, note text, first image as simple media (full media rendering ports
// with the shared core). Long-press hooks in at W3 (actions sheet).

export interface NoteCardProps {
  event: NostrEvent;
  onPress?: () => void;
  onLongPress?: () => void;
}

export const NoteCard = memo(function NoteCard({ event, onPress, onLongPress }: NoteCardProps) {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.profiles.byPubkey[event.pubkey]);
  const zaps = useAppSelector((s) => s.zaps.byEvent[event.id]);
  const { text, images } = useMemo(() => splitNoteContent(event.content), [event.content]);
  const name = profileDisplayName(profile, event.pubkey);

  return (
    <Card onPress={onPress} onLongPress={onLongPress} haptic={false} className="p-4">
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}'s profile`}
          onPress={() => navigation.navigate("Profile", { pubkey: event.pubkey })}
          hitSlop={6}
        >
          <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={40} />
        </Pressable>
        <View className="flex-1 flex-row items-baseline gap-2">
          <Type role="body" weight={600} className="shrink text-heading" numberOfLines={1}>
            {name}
          </Type>
          <Type role="caption" className="text-faint">
            {formatRelativeTime(event.created_at)}
          </Type>
        </View>
      </View>

      {text ? (
        <Type role="body" className="mt-2.5 leading-[21px] text-body" numberOfLines={12}>
          {text}
        </Type>
      ) : null}

      {images.length > 0 ? (
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel="Open image"
          className="mt-3 overflow-hidden rounded-lg bg-surface"
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
              <Type role="micro" weight={600} className="text-white">
                +{images.length - 1}
              </Type>
            </View>
          ) : null}
        </Pressable>
      ) : null}

      {zaps && zaps.count > 0 ? (
        <View className="mt-2.5 flex-row items-center gap-1">
          <ZapIcon size={12} color="#eab308" fill="#eab308" strokeWidth={1} />
          <Type role="micro" tabular weight={500} className="text-muted">
            {Math.round(zaps.msat / 1000).toLocaleString()} sats
            {zaps.count > 1 ? ` · ${zaps.count} zaps` : ""}
          </Type>
        </View>
      ) : null}
    </Card>
  );
});

/** Content-shaped loading stand-in for the feed. */
export function NoteCardSkeleton() {
  return (
    <View className="rounded-xl bg-card p-4">
      <View className="flex-row items-center gap-3">
        <SkeletonCircle size={40} />
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
