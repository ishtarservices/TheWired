import { Pressable, View } from "react-native";

import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import type { FeedContext } from "@/store/slices/feedSlice";

// Quiet mono scope tabs above the notes feed — `global · follows` in the
// SpaceSwitcher register (lowercase protocol voice, no border, no thumb).
// Active = heading ink; inactive = muted + dimmed.

const SCOPES: readonly { value: FeedContext; label: string }[] = [
  { value: "global", label: "global" },
  { value: "follows", label: "follows" },
];

export function FeedScopeToggle({
  scope,
  onChange,
}: {
  scope: FeedContext;
  onChange: (scope: FeedContext) => void;
}) {
  return (
    <View className="flex-row items-center gap-2 px-4 pb-2">
      {SCOPES.map((entry, i) => {
        const selected = entry.value === scope;
        return (
          <View key={entry.value} className="flex-row items-center gap-2">
            {i > 0 ? (
              <Type role="metaLabel" className="text-faint">
                ·
              </Type>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              hitSlop={8}
              className="py-1 active:opacity-80"
              style={{ opacity: selected ? 1 : 0.75 }}
              onPress={() => {
                if (selected) return;
                haptics.selection();
                onChange(entry.value);
              }}
            >
              <Type
                role="metaLabel"
                className={selected ? "lowercase text-heading" : "lowercase text-muted"}
              >
                {entry.label}
              </Type>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
