import type { ReactNode } from "react";
import { View } from "react-native";

import { Type } from "./Type";
import { cn } from "@/lib/cn";

// Lowercase-calm section label (untitled.stream register): quiet, small,
// generous top spacing so sections breathe without divider lines.

export interface SectionHeaderProps {
  label: string;
  /** Optional right-aligned action (a small Button or Pill). */
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ label, action, className }: SectionHeaderProps) {
  return (
    <View className={cn("flex-row items-end justify-between px-1 pb-2 pt-5", className)}>
      <Type role="caption" weight={500} className="lowercase tracking-wide text-muted">
        {label}
      </Type>
      {action ?? null}
    </View>
  );
}
