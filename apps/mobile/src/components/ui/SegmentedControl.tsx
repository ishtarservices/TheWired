import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { Type } from "./Type";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { SHADOWS } from "@/theme/constants";
import { SPRING } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

// iOS-style segmented control with a spring-animated thumb — the affordance
// class where a border IS part of the design language (inputs & controls).
// Used for sub-view switching (Channel chat/notes/media, feed/spaces, …).

export interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

const THUMB_INSET = 3;

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const { tokens } = useTheme();
  const [width, setWidth] = useState(0);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const segmentWidth = width > 0 ? (width - THUMB_INSET * 2) / options.length : 0;

  const translateX = useSharedValue(selectedIndex * segmentWidth);
  // Keep the shared value in lockstep with props/layout — in an effect, not
  // during render (reanimated strict mode flags render-time writes).
  useEffect(() => {
    translateX.value = withSpring(selectedIndex * segmentWidth, SPRING.snappy);
  }, [translateX, selectedIndex, segmentWidth]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      className={cn(
        "h-10 flex-row rounded-full border border-border-light bg-surface",
        className,
      )}
      style={{ padding: THUMB_INSET }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="tablist"
    >
      {segmentWidth > 0 ? (
        // Animated style ⇒ no className on this element (lib/animated.ts).
        <Animated.View
          style={[
            {
              position: "absolute",
              top: THUMB_INSET,
              bottom: THUMB_INSET,
              left: THUMB_INSET,
              width: segmentWidth,
              borderRadius: 999,
              backgroundColor: tokens.card,
            },
            SHADOWS.sm,
            thumbStyle,
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className="flex-1 items-center justify-center rounded-full"
            onPress={() => {
              if (!selected) {
                haptics.selection();
                onChange(option.value);
              }
            }}
          >
            <Type
              role="caption"
              weight={selected ? 600 : 500}
              className={selected ? "text-heading" : "text-muted"}
            >
              {option.label}
            </Type>
          </Pressable>
        );
      })}
    </View>
  );
}
