import { Pressable, StyleSheet } from "react-native";

import { Type } from "@/components/ui/Type";
import { AnimatedView } from "@/lib/animated";
import { haptics } from "@/lib/haptics";
import { SHADOWS } from "@/theme/constants";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

// Floating "new notes" affordance while the feed is frozen mid-read. Quiet
// protocol voice on a raised panel — hairline border, no primary fill (the
// tab bar's active circle owns this screen's one inversion).

export function NewNotesPill({
  count,
  topOffset,
  onPress,
}: {
  count: number;
  topOffset: number;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const label =
    count > 99 ? "99+ new notes" : `${count} new note${count === 1 ? "" : "s"}`;

  return (
    <AnimatedView
      // entering= is undefined under reduce-motion (safe XOR combo: AnimatedView
      // + className + entering — no useAnimatedStyle anywhere here).
      entering={motion.fade()}
      pointerEvents="box-none"
      className="absolute left-0 right-0 items-center"
      style={{ top: topOffset }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} — scroll to top`}
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        className="rounded-full bg-panel px-3.5 py-1.5 active:opacity-80"
        style={[
          { borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
          SHADOWS.md,
        ]}
      >
        <Type role="metaLabel" className="lowercase text-soft">
          {label}
        </Type>
      </Pressable>
    </AnimatedView>
  );
}
