import { Image, Pressable, View } from "react-native";
import { Disc3, Music, Play } from "lucide-react-native";
import type { MusicItem } from "../musicEventParser";

import { Type } from "@/components/ui/Type";
import { formatTrackDuration } from "../musicEventParser";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import { selectIsCurrent } from "@/store/slices/musicSlice";
import { useTheme } from "@/theme/ThemeContext";

// Track/album row for the music channel. Tracks tap-to-play (onPress →
// playQueue upstream); the now-playing track shows a static ▶ indicator and a
// primary-tinted title (no marquee/animation — signal restraint).

export function TrackRow({
  item,
  onPress,
  onLongPress,
}: {
  item: MusicItem;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const { tokens } = useTheme();
  const profile = useAppSelector((s) => s.profiles.byPubkey[item.event.pubkey]);
  const isCurrent = useAppSelector((s) => selectIsCurrent(s, item.addressableId));
  const artist = item.artist ?? profileDisplayName(profile, item.event.pubkey);
  const Fallback = item.kind === "album" ? Disc3 : Music;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} by ${artist}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className="min-h-[64px] flex-row items-center gap-3 rounded-xl bg-card p-3 active:bg-card-hover"
    >
      {item.artwork ? (
        <Image
          source={{ uri: item.artwork }}
          className="h-12 w-12 rounded-lg bg-surface"
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View className="h-12 w-12 items-center justify-center rounded-lg bg-surface">
          <Fallback size={20} color={tokens.muted} strokeWidth={1.75} />
        </View>
      )}
      <View className="flex-1">
        <Type
          role="body"
          weight={600}
          className={isCurrent ? "text-primary" : "text-heading"}
          numberOfLines={1}
        >
          {item.title}
        </Type>
        <Type role="caption" className="mt-0.5 text-muted" numberOfLines={1}>
          {artist}
        </Type>
      </View>
      {isCurrent ? (
        <Play size={13} color={tokens.primary} strokeWidth={2} fill={tokens.primary} />
      ) : item.kind === "album" ? (
        <Type role="micro" tabular className="text-faint">
          {item.trackCount ? `${item.trackCount} tracks` : "album"}
        </Type>
      ) : item.durationSec ? (
        <Type role="micro" tabular className="text-faint">
          {formatTrackDuration(item.durationSec)}
        </Type>
      ) : null}
    </Pressable>
  );
}
