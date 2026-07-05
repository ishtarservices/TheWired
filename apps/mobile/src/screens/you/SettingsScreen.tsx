import { Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";
import { PRESETS } from "@/theme/presets";
import { useTheme } from "@/theme/ThemeContext";

// The theme picker is real already — it exercises the runtime preset
// switching end to end (vars() → NativeWind → every mounted screen).

export function SettingsScreen() {
  const { preset, setPreset, presetKeys, motionIntensity } = useTheme();

  return (
    <PlaceholderScreen
      title="Settings"
      description="Security / Wallet / Relays / Theme / Features sub-screens land in Phase 2+. Host-relay & auto-updater stay desktop-only."
    >
      <View className="rounded-lg border border-border bg-card p-4">
        <Text className="text-sm font-semibold text-heading">Theme</Text>
        <Text className="mt-1 text-xs text-muted">
          Live preset switching — motion intensity {motionIntensity}
        </Text>
        <View className="mt-3 gap-2">
          {presetKeys.map((key) => (
            <Button
              key={key}
              variant={key === preset ? "primary" : "secondary"}
              onPress={() => setPreset(key)}
            >
              {`${PRESETS[key].emoji}  ${PRESETS[key].title}`}
            </Button>
          ))}
        </View>
      </View>
    </PlaceholderScreen>
  );
}
