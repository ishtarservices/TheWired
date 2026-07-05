import type { ReactNode } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Type } from "./Type";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";

// Settings/list staple (W1 §6): leading slot (avatar/icon), title + optional
// subtitle, trailing meta and/or chevron. 56pt minimum height; press feedback
// is a surface tint, not a border.

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Leading element — an icon or <Avatar>. */
  leading?: ReactNode;
  /** Trailing element before the chevron — a value, <Pill>, switch, … */
  trailing?: ReactNode;
  /** Show a chevron affordance (default: only when onPress is set). */
  chevron?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  destructive?: boolean;
  haptic?: boolean;
  className?: string;
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron,
  onPress,
  destructive = false,
  haptic = true,
  className,
}: ListRowProps) {
  const { tokens } = useTheme();
  const showChevron = chevron ?? !!onPress;

  const content = (
    <>
      {leading ? <View className="mr-3">{leading}</View> : null}
      <View className="flex-1">
        <Type
          role="body"
          weight={500}
          className={destructive ? "text-destructive" : "text-heading"}
          numberOfLines={1}
        >
          {title}
        </Type>
        {subtitle ? (
          <Type role="caption" className="mt-0.5 text-muted" numberOfLines={1}>
            {subtitle}
          </Type>
        ) : null}
      </View>
      {trailing ? <View className="ml-3">{trailing}</View> : null}
      {showChevron ? (
        <ChevronRight size={18} color={tokens.faint} style={{ marginLeft: 6 }} />
      ) : null}
    </>
  );

  const base = cn("min-h-[56px] flex-row items-center px-4 py-2", className);

  if (!onPress) {
    return <View className={base}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => haptic && haptics.selection()}
      className={cn(base, "active:bg-surface-hover")}
    >
      {content}
    </Pressable>
  );
}
