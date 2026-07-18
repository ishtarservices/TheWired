import { useCallback, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Disc3,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react-native";
import { useProgress } from "react-native-track-player";

import { Type } from "@/components/ui/Type";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { formatTrackDuration } from "@/screens/spaces/musicEventParser";
import {
  cycleRepeat,
  jumpTo,
  next,
  previous,
  seekTo,
  togglePlay,
  toggleShuffle,
} from "@/store/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectCurrentId,
  selectPlayer,
  selectPlayerStatus,
} from "@/store/slices/musicSlice";
import { useTheme } from "@/theme/ThemeContext";

export function NowPlayingScreen() {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();

  const currentId = useAppSelector(selectCurrentId);
  const status = useAppSelector(selectPlayerStatus);
  const player = useAppSelector(selectPlayer);
  const current = useAppSelector((s) =>
    currentId ? s.music.itemsById[currentId] : undefined,
  );
  const itemsById = useAppSelector((s) => s.music.itemsById);
  const { position, duration } = useProgress(500);

  const [barWidth, setBarWidth] = useState(0);
  const onBarLayout = useCallback((e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width);
  }, []);
  const onSeek = useCallback(
    (e: GestureResponderEvent) => {
      if (barWidth <= 0 || duration <= 0) return;
      const fraction = Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth));
      void dispatch(seekTo(fraction * duration));
    },
    [barWidth, duration, dispatch],
  );

  if (!current) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-8">
        <Disc3 size={36} color={tokens.faint} strokeWidth={1.5} />
        <Type role="body" className="mt-3 text-muted">
          Nothing playing
        </Type>
      </View>
    );
  }

  const artwork = safeImageUri(current.artwork);
  const isPlaying = status === "playing";
  const pct = duration > 0 ? Math.min(1, position / duration) : 0;
  const Glyph = isPlaying ? Pause : Play;
  const RepeatGlyph = player.repeat === "track" ? Repeat1 : Repeat;
  const repeatActive = player.repeat !== "off";

  // Upcoming = queue after the current track.
  const currentIdx = player.queueIds.indexOf(current.addressableId);
  const upcoming = currentIdx >= 0 ? player.queueIds.slice(currentIdx + 1) : [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 32, paddingTop: 8 }}
    >
      {/* Artwork */}
      <View className="items-center pt-2">
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            style={{
              width: "100%",
              aspectRatio: 1,
              borderRadius: 16,
              backgroundColor: tokens.surface,
            }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={{
              width: "100%",
              aspectRatio: 1,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tokens.surface,
            }}
          >
            <Disc3 size={64} color={tokens.muted} strokeWidth={1.25} />
          </View>
        )}
      </View>

      {/* Title + artist */}
      <View className="mt-6">
        <Type role="title" weight={700} className="text-heading" numberOfLines={2}>
          {current.title}
        </Type>
        {current.artist ? (
          <Type role="body" className="mt-1 text-muted" numberOfLines={1}>
            {current.artist}
          </Type>
        ) : null}
      </View>

      {/* Seek bar (tap to seek) */}
      <Pressable
        onPress={onSeek}
        onLayout={onBarLayout}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        hitSlop={12}
        className="mt-6"
      >
        <View style={{ height: 3, borderRadius: 2, backgroundColor: tokens.borderLight }}>
          <View
            style={{
              height: 3,
              borderRadius: 2,
              width: `${pct * 100}%`,
              backgroundColor: tokens.primary,
            }}
          />
        </View>
      </Pressable>
      <View className="mt-2 flex-row justify-between">
        <Type role="micro" tabular className="text-faint">
          {formatTrackDuration(Math.floor(position))}
        </Type>
        <Type role="micro" tabular className="text-faint">
          {duration > 0 ? formatTrackDuration(Math.floor(duration)) : "--:--"}
        </Type>
      </View>

      {/* Transport */}
      <View className="mt-6 flex-row items-center justify-between">
        <Pressable
          onPress={() => dispatch(toggleShuffle())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Shuffle"
        >
          <Shuffle
            size={20}
            color={player.shuffle ? tokens.primary : tokens.muted}
            strokeWidth={2}
          />
        </Pressable>

        <Pressable
          onPress={() => dispatch(previous())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous"
        >
          <SkipBack size={28} color={tokens.heading} strokeWidth={2} fill={tokens.heading} />
        </Pressable>

        <Pressable
          onPress={() => dispatch(togglePlay())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tokens.primary,
          }}
        >
          <Glyph size={28} color={tokens.primaryForeground} strokeWidth={2} fill={tokens.primaryForeground} />
        </Pressable>

        <Pressable
          onPress={() => dispatch(next())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Next"
        >
          <SkipForward size={28} color={tokens.heading} strokeWidth={2} fill={tokens.heading} />
        </Pressable>

        <Pressable
          onPress={() => dispatch(cycleRepeat())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Repeat"
        >
          <RepeatGlyph
            size={20}
            color={repeatActive ? tokens.primary : tokens.muted}
            strokeWidth={2}
          />
        </Pressable>
      </View>

      {/* Up next */}
      {upcoming.length > 0 ? (
        <View className="mt-10">
          <Type role="meta" className="mb-3 text-faint">
            UP NEXT
          </Type>
          <View className="gap-1">
            {upcoming.map((id) => {
              const item = itemsById[id];
              if (!item) return null;
              return (
                <Pressable
                  key={id}
                  onPress={() => dispatch(jumpTo(id))}
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${item.title}`}
                  className="flex-row items-center gap-3 rounded-lg p-2 active:bg-card"
                >
                  <View className="flex-1">
                    <Type role="body" className="text-heading" numberOfLines={1}>
                      {item.title}
                    </Type>
                    {item.artist ? (
                      <Type role="micro" className="mt-0.5 text-muted" numberOfLines={1}>
                        {item.artist}
                      </Type>
                    ) : null}
                  </View>
                  {item.durationSec ? (
                    <Type role="micro" tabular className="text-faint">
                      {formatTrackDuration(item.durationSec)}
                    </Type>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
