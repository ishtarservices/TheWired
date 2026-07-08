import { Pressable, ScrollView } from "react-native";

import { Type } from "@/components/ui/Type";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";

// Horizontal filter chips (categories, sort). Selection is a tonal accent —
// same vocabulary as Pill's primary tone — with a selection-tick haptic.

export interface Chip {
  value: string;
  label: string;
}

export function ChipRow({
  chips,
  selected,
  onSelect,
  className,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (value: string) => void;
  className?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      className={className}
    >
      {chips.map((chip) => {
        const isSelected = chip.value === selected;
        return (
          <Pressable
            key={chip.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            hitSlop={6}
            onPress={() => {
              if (!isSelected) {
                haptics.selection();
                onSelect(chip.value);
              }
            }}
            className={cn(
              "h-9 items-center justify-center rounded-full px-3.5",
              isSelected ? "bg-primary-dim" : "bg-surface active:bg-surface-hover",
            )}
          >
            <Type
              role="caption"
              weight={isSelected ? 600 : 500}
              className={cn("lowercase", isSelected ? "text-primary-soft" : "text-muted")}
            >
              {chip.label}
            </Type>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
