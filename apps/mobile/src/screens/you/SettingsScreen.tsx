import { Check } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { deriveTokens } from "@/theme/engine";
import { PRESETS } from "@/theme/presets";
import { useTheme } from "@/theme/ThemeContext";

// Theme picker as a swatch grid with live preview cards (W1 §7) — each
// swatch renders its preset's actual derived surfaces, so choosing a theme
// is seeing it. Tapping applies instantly (runtime vars() switch).

function PresetSwatch({
  presetKey,
  selected,
  onSelect,
}: {
  presetKey: string;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const preset = PRESETS[presetKey];
  const { tokens: activeTokens } = useTheme();
  const t = deriveTokens(
    preset.colors.background,
    preset.colors.foreground,
    preset.colors.primary,
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="w-[48%] overflow-hidden rounded-xl"
      style={{
        borderWidth: 2,
        borderColor: selected ? activeTokens.primary : "transparent",
      }}
      onPress={() => {
        haptics.selection();
        onSelect(presetKey);
      }}
    >
      {/* Mini live preview — the preset's own derived tokens, not the active theme's */}
      <View style={{ backgroundColor: t.background }} className="p-3 pb-2.5">
        <View
          style={{ backgroundColor: t.card }}
          className="rounded-lg p-2.5"
        >
          <View
            style={{ backgroundColor: t.heading, opacity: 0.9 }}
            className="h-2 w-3/5 rounded-full"
          />
          <View
            style={{ backgroundColor: t.muted, opacity: 0.5 }}
            className="mt-1.5 h-2 w-4/5 rounded-full"
          />
          <View className="mt-2.5 flex-row items-center gap-1.5">
            <View
              style={{ backgroundColor: t.primary }}
              className="h-4 w-10 rounded-full"
            />
            <View
              style={{ backgroundColor: t.panel }}
              className="h-4 w-6 rounded-full"
            />
          </View>
        </View>
        <View className="mt-2.5 flex-row items-center justify-between px-0.5">
          <Type role="micro" weight={600} style={{ color: t.heading }}>
            {preset.title.toLowerCase()}
          </Type>
          {selected ? <Check size={13} color={t.primary} strokeWidth={3} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

export function SettingsScreen() {
  const { preset, setPreset, presetKeys, motionIntensity } = useTheme();

  return (
    <Screen scroll contentClassName="px-5">
      <SectionHeader label="appearance" />
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {presetKeys.map((key) => (
          <PresetSwatch
            key={key}
            presetKey={key}
            selected={key === preset}
            onSelect={setPreset}
          />
        ))}
      </View>
      <Type role="micro" className="mt-3 px-1 text-faint">
        motion intensity {motionIntensity} · follows the preset; the system
        reduce-motion setting always wins
      </Type>

      <SectionHeader label="coming soon" />
      <Card>
        <Type role="caption" className="leading-5 text-muted">
          Security, wallet, relays and feature toggles land with their
          surfaces (Phase 2+). Host-relay and the auto-updater stay
          desktop-only.
        </Type>
      </Card>
    </Screen>
  );
}
