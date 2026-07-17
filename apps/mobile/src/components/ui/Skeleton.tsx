import { useEffect } from "react";
import { View, type ViewProps } from "react-native";
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
import { cn } from "@/lib/cn";
import { useMotion } from "@/theme/motion";

// Content-shaped loading (W1 §6): every "loading" state renders the shape of
// what's coming — never a bare Spinner. The pulse is a soft opacity breathe;
// reduce-motion (or a 0-intensity preset) renders it static.
//
// The pulsing element is an AnimatedPlainView carrying ONLY the animated
// style — the css-interop-registered Animated.View drops animated styles
// (see lib/animated.ts); the shape itself is a plain View inside.

const PULSE_MS = 900;

function Pulse({ children }: { children: React.ReactNode }) {
  const { intensity } = useMotion();
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    if (intensity <= 0) {
      opacity.value = 0.55;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, {
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

  return <AnimatedPlainView style={pulseStyle}>{children}</AnimatedPlainView>;
}

export interface SkeletonProps extends ViewProps {
  className?: string;
}

/** Base block — size it with className (h-*, w-*, rounded-*). */
export function Skeleton({ className, style, ...rest }: SkeletonProps) {
  return (
    <Pulse>
      <View className={cn("rounded-md bg-surface-hover", className)} style={style} {...rest} />
    </Pulse>
  );
}

export function SkeletonCircle({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Pulse>
      <View
        className={cn("bg-surface-hover", className)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    </Pulse>
  );
}

/** A few text-shaped lines; the last line is shorter, like real copy. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <View className={cn("gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </View>
  );
}
