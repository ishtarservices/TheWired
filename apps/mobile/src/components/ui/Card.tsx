import { useState, type ReactNode } from "react";
import { Pressable, View, type GestureResponderEvent, type ViewProps } from "react-native";

import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { SHADOWS } from "@/theme/constants";
import { useMotion } from "@/theme/motion";

// Tonal surface card (W1 §6): depth from the surface ramp (bg-card over
// bg-background), 16px radius, optional elevation shadow — NOT a border.
// Borders stay reserved for interactive affordances (inputs, segmented
// controls). Pass onPress to get the pressable variant with press-scale
// (pressed-state style — see lib/animated.ts for why not a Reanimated style).

export interface CardProps extends ViewProps {
  /** 0 = flat tonal, 1 = resting shadow, 2 = raised (sheets, popovers). */
  elevation?: 0 | 1 | 2;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  /** Haptic tick on press (pressable variant only, default on). */
  haptic?: boolean;
  className?: string;
  children?: ReactNode;
}

const ELEVATION_STYLES = [undefined, SHADOWS.sm, SHADOWS.md] as const;

export function Card({
  elevation = 0,
  onPress,
  onLongPress,
  haptic = true,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  const { pressScale } = useMotion();
  const [pressed, setPressed] = useState(false);

  const base = cn("rounded-xl bg-card p-4", className);
  const elevationStyle = ELEVATION_STYLES[elevation];

  if (!onPress && !onLongPress) {
    return (
      <View className={base} style={[elevationStyle, style]} {...rest}>
        {children}
      </View>
    );
  }

  const pressedStyle =
    pressed && pressScale < 1 ? { transform: [{ scale: pressScale }] } : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        setPressed(true);
        if (haptic) haptics.selection();
      }}
      onPressOut={() => setPressed(false)}
      className={base}
      style={[elevationStyle, pressedStyle, style as object]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}
