import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

// Foundation scaffold — every placeholder screen renders through this so the
// shell is fully themed end to end. Replaced screen-by-screen in Phase 2+.

export interface PlaceholderScreenProps {
  title: string;
  /** What the real screen will hold (ties back to mobile-guide/03 §3). */
  description?: string;
  /** Route params etc. worth showing while screens are stubs. */
  detail?: string;
  children?: ReactNode;
}

export function PlaceholderScreen({
  title,
  description,
  detail,
  children,
}: PlaceholderScreenProps) {
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-5"
    >
      <View className="rounded-lg border border-border bg-card p-4">
        <Text className="text-lg font-semibold text-heading">{title}</Text>
        {description ? (
          <Text className="mt-1 text-sm leading-5 text-soft">{description}</Text>
        ) : null}
        {detail ? (
          <Text className="mt-2 text-xs text-muted">{detail}</Text>
        ) : null}
      </View>
      {children ? <View className="gap-3">{children}</View> : null}
    </ScrollView>
  );
}
