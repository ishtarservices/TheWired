import type { ComponentType, ReactNode } from "react";
import { View } from "react-native";
import { CircleDashed, type LucideProps } from "lucide-react-native";

import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";

// Foundation scaffold — screens not yet built render a calm empty state
// (one icon, one sentence, at most one action) instead of a placeholder
// paragraph. Replaced screen-by-screen in Phase 2+.

export interface PlaceholderScreenProps {
  title: string;
  /** One sentence about what this screen will hold. */
  description?: string;
  /** Literal icon for the surface (lucide) — defaults to a dashed circle. */
  icon?: ComponentType<LucideProps>;
  /** Route params etc. worth surfacing while screens are stubs. */
  detail?: string;
  children?: ReactNode;
}

export function PlaceholderScreen({
  title,
  description,
  icon,
  detail,
  children,
}: PlaceholderScreenProps) {
  return (
    <Screen scroll contentClassName="flex-grow px-5">
      <EmptyState
        icon={icon ?? CircleDashed}
        title={title}
        message={description}
        className="py-10"
      />
      {detail ? (
        <View className="items-center pb-4">
          <Pill label={detail} />
        </View>
      ) : null}
      {children ? <View className="gap-3 pb-6">{children}</View> : null}
    </Screen>
  );
}
