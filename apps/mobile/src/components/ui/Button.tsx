import { useState, type ReactNode } from "react";
import { Pressable, type GestureResponderEvent, type PressableProps } from "react-native";

import { Spinner } from "./Spinner";
import { Type } from "./Type";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";
import type { TypeRole } from "@/theme/typography";

// Same variant vocabulary as the desktop Button (client/src/components/ui/
// Button.tsx), reworked for touch and the W1 design system: pill silhouette,
// tonal secondary (no border — depth comes from surface steps), press-scale
// + fade gated by the preset's motion intensity, layered haptics (light
// impact on primary actions, selection tick elsewhere).
//
// Press feedback is a pressed-state style, not a Reanimated style — animated
// styles can't share an element with className (see lib/animated.ts).

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary",
  secondary: "bg-card",
  ghost: "bg-transparent active:bg-surface-hover",
  destructive: "bg-destructive",
};

const TEXT_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-primary-fg",
  secondary: "text-body",
  ghost: "text-soft",
  destructive: "text-destructive-fg",
};

// min-h keeps every size ≥ the 44pt touch floor (MIN_TOUCH_TARGET).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-[44px] px-4",
  md: "min-h-[48px] px-5",
  lg: "min-h-[54px] px-6",
};

const TEXT_ROLES: Record<ButtonSize, TypeRole> = {
  sm: "caption",
  md: "body",
  lg: "headline",
};

export interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Haptic feedback on press (default on; impact for primary/destructive,
   *  selection tick for the rest). */
  haptic?: boolean;
  /** Replaces the label with a spinner and disables presses. */
  loading?: boolean;
  className?: string;
  textClassName?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  haptic = true,
  loading = false,
  className,
  textClassName,
  children,
  disabled,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: ButtonProps) {
  const { tokens } = useTheme();
  const { pressScale } = useMotion();
  const [pressed, setPressed] = useState(false);

  const handlePressIn = (event: GestureResponderEvent) => {
    setPressed(true);
    if (haptic) {
      if (variant === "primary" || variant === "destructive") haptics.tap();
      else haptics.selection();
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    setPressed(false);
    onPressOut?.(event);
  };

  const pressedStyle =
    pressed && pressScale < 1
      ? { transform: [{ scale: pressScale }], opacity: 0.92 }
      : undefined;

  const spinnerColor = variant === "primary" ? tokens.primaryForeground : tokens.soft;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-full",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        disabled && "opacity-40",
        className,
      )}
      style={[pressedStyle, style as object]}
      {...rest}
    >
      {loading ? (
        <Spinner color={spinnerColor} />
      ) : typeof children === "string" ? (
        <Type
          role={TEXT_ROLES[size]}
          weight={600}
          className={cn(TEXT_CLASSES[variant], textClassName)}
        >
          {children}
        </Type>
      ) : (
        children
      )}
    </Pressable>
  );
}
