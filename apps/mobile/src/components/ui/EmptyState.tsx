import type { ComponentType, ReactNode } from "react";
import { View } from "react-native";
import type { LucideProps } from "lucide-react-native";

import { Type } from "./Type";
import { cn } from "@/lib/cn";
import { useTheme } from "@/theme/ThemeContext";

// Empty/first-run surface (W1 §6): one calm icon, one sentence, at most one
// action. No placeholder paragraphs.

export interface EmptyStateProps {
  icon: ComponentType<LucideProps>;
  title: string;
  /** One sentence. */
  message?: string;
  /** One action (a Button). */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  const { tokens } = useTheme();
  return (
    <View className={cn("flex-1 items-center justify-center px-8 py-16", className)}>
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface">
        <Icon size={26} color={tokens.muted} strokeWidth={1.75} />
      </View>
      <Type role="headline" className="mt-5 text-center text-heading">
        {title}
      </Type>
      {message ? (
        <Type role="caption" className="mt-2 max-w-[280px] text-center leading-5 text-muted">
          {message}
        </Type>
      ) : null}
      {action ? <View className="mt-6 w-full max-w-[280px]">{action}</View> : null}
    </View>
  );
}
