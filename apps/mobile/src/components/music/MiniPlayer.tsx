import { useCallback } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Music, Pause, Play } from "lucide-react-native";
import { useProgress } from "react-native-track-player";

import { Type } from "@/components/ui/Type";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { togglePlay } from "@/store/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectCurrentItem, selectPlayerStatus } from "@/store/slices/musicSlice";
import { useTheme } from "@/theme/ThemeContext";

// Docked mini-player. Rendered INSIDE FloatingTabBar's outer container, above
// the pill, so its height folds into the bar's onLayout report and every
// screen's useScreenInsets().bottom clears both (zero consumer changes). Plain
// styles only (no className) to stay clear of the css-interop XOR rule and to
// match the tab bar's own idiom. Renders null when nothing is loaded → the
// container shrinks and the reported height drops back to the pill alone.
// Horizontal inset comes from the tab bar container's padding (aligns with the
// pill); only a bottom gap is added here so it reads as a second stacked pill.

export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const { tokens } = useTheme();
  const dispatch = useAppDispatch();
  const current = useAppSelector(selectCurrentItem);
  const status = useAppSelector(selectPlayerStatus);
  // Live position drives the hairline; only this component re-renders on tick.
  const { position, duration } = useProgress(500);

  const onToggle = useCallback(() => {
    void dispatch(togglePlay());
  }, [dispatch]);

  // Hooks above run unconditionally; bail after them when idle.
  if (!current) return null;

  const pct = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const isPlaying = status === "playing";
  const artwork = safeImageUri(current.artwork);
  const Glyph = isPlaying ? Pause : Play;

  return (
    <Pressable
      testID="mini-player"
      accessibilityRole="button"
      accessibilityLabel={`Now playing: ${current.title}${current.artist ? ` by ${current.artist}` : ""}`}
      onPress={onOpen}
      style={{
        marginBottom: 8,
        height: 48,
        borderRadius: 14,
        overflow: "hidden",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokens.borderLight,
        backgroundColor: tokens.card,
      }}
    >
      {/* Progress hairline along the top edge. */}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: tokens.borderLight }}>
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            width: `${pct * 100}%`,
            backgroundColor: tokens.primary,
          }}
        />
      </View>
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 10,
          gap: 10,
        }}
      >
        {artwork ? (
          <Image
            source={{ uri: artwork }}
            style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: tokens.surface }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: tokens.surface,
            }}
          >
            <Music size={14} color={tokens.muted} strokeWidth={1.75} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Type role="meta" weight={600} className="text-heading" numberOfLines={1}>
            {current.title}
          </Type>
          {current.artist ? (
            <Type role="micro" className="text-muted" numberOfLines={1}>
              {current.artist}
            </Type>
          ) : null}
        </View>
        <Pressable
          onPress={onToggle}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? "Pause" : "Play"}
          style={{ padding: 6 }}
        >
          <Glyph size={20} color={tokens.heading} strokeWidth={2} fill={tokens.heading} />
        </Pressable>
      </View>
    </Pressable>
  );
}
