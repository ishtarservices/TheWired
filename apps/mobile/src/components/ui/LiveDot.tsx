// Liveness without color: a small dot with a slow opacity breathe. Status is
// expressed through motion + contrast + mono labels app-wide — never
// green/red dots. Tone comes from theme tokens (near-white in signal, the
// preset's fg/accent elsewhere). Reduce-motion (or a 0-intensity preset)
// renders it static — the Skeleton pulse pattern.
//
// AnimatedPlainView + plain styles only (lib/animated.ts).

import { useEffect } from "react";
import {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AnimatedPlainView } from "@/lib/animated";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

const PULSE_MS = 1400;
const MIN_OPACITY = 0.35;

export interface LiveDotProps {
  size?: number;
  tone?: "primary" | "heading" | "muted";
}

export function LiveDot({ size = 6, tone = "heading" }: LiveDotProps) {
  const { tokens } = useTheme();
  const { intensity } = useMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (intensity <= 0) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(MIN_OPACITY, {
        duration: PULSE_MS,
        easing: Easing.inOut(Easing.ease),
        reduceMotion: ReduceMotion.System,
      }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [intensity, opacity]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <AnimatedPlainView
      accessibilityElementsHidden
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tokens[tone],
        },
        pulseStyle,
      ]}
    />
  );
}
