import { type ReactNode } from "react";
import { Pressable, Text, type GestureResponderEvent, type PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

import { cn } from "@/lib/cn";

// Same variant vocabulary as the desktop Button (client/src/components/ui/
// Button.tsx), reworked for touch: hover-lift is gone, every size meets the
// 44pt target, and presses give light haptic feedback.

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary active:opacity-85",
  secondary: "bg-card border border-border active:bg-card-hover",
  ghost: "bg-transparent active:bg-surface-hover",
  destructive: "bg-destructive active:opacity-85",
};

const TEXT_CLASSES: Record<ButtonVariant, string> = {
  primary: "text-primary-fg",
  secondary: "text-body",
  ghost: "text-soft",
  destructive: "text-destructive-fg",
};

// min-h keeps every size ≥ the 44pt touch floor (MIN_TOUCH_TARGET).
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-[44px] px-3",
  md: "min-h-[44px] px-4",
  lg: "min-h-[52px] px-6",
};

const TEXT_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Light haptic tick on press (default on). */
  haptic?: boolean;
  className?: string;
  textClassName?: string;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  haptic = true,
  className,
  textClassName,
  children,
  disabled,
  onPressIn,
  ...rest
}: ButtonProps) {
  const handlePressIn = (event: GestureResponderEvent) => {
    if (haptic) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPressIn?.(event);
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={handlePressIn}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-md",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        disabled && "opacity-40",
        className,
      )}
      {...rest}
    >
      {typeof children === "string" ? (
        <Text
          className={cn(
            "font-medium",
            TEXT_CLASSES[variant],
            TEXT_SIZE_CLASSES[size],
            textClassName,
          )}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
