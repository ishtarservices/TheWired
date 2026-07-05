import { View } from "react-native";

import { Type } from "./Type";
import { cn } from "@/lib/cn";

// Small status/meta chip. Tonal fills from the theme ramp — quiet by default,
// primary-dim for accented states.

export type PillTone = "neutral" | "primary" | "success" | "warning" | "destructive";

const TONE_CLASSES: Record<PillTone, { bg: string; text: string }> = {
  neutral: { bg: "bg-surface-hover", text: "text-soft" },
  primary: { bg: "bg-primary-dim", text: "text-primary-soft" },
  success: { bg: "bg-surface-hover", text: "text-success" },
  warning: { bg: "bg-surface-hover", text: "text-warning" },
  destructive: { bg: "bg-surface-hover", text: "text-destructive" },
};

export interface PillProps {
  label: string;
  tone?: PillTone;
  className?: string;
}

export function Pill({ label, tone = "neutral", className }: PillProps) {
  const classes = TONE_CLASSES[tone];
  return (
    <View className={cn("self-start rounded-full px-2.5 py-1", classes.bg, className)}>
      <Type role="micro" weight={500} className={classes.text}>
        {label}
      </Type>
    </View>
  );
}
