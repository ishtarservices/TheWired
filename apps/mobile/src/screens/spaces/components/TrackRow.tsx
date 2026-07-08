import { Image, Pressable, View } from "react-native";
import { Disc3, Music } from "lucide-react-native";
import type { MusicItem } from "../musicEventParser";

import { Type } from "@/components/ui/Type";
import { formatTrackDuration } from "../musicEventParser";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Track/album row for the music channel — browsable metadata (artwork,
// title, artist, duration); playback arrives with the mobile player.

export function TrackRow({
  item,
  onLongPress,
}: {
  item: MusicItem;
  onLongPress?: () => void;
}) {
  const { tokens } = useTheme();
  const profile = useAppSelector((s) => s.profiles.byPubkey[item.event.pubkey]);
  const artist = item.artist ?? profileDisplayName(profile, item.event.pubkey);
  const Fallback = item.kind === "album" ? Disc3 : Music;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} by ${artist}`}
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
        <Type role="body" weight={600} className="text-heading" numberOfLines={1}>
          {item.title}
        </Type>
        <Type role="caption" className="mt-0.5 text-muted" numberOfLines={1}>
          {artist}
        </Type>
      </View>
      {item.kind === "album" ? (
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
