import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

import { useTheme } from "@/theme/ThemeContext";

/** Shared themed options for every native stack (headers follow the preset). */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { tokens } = useTheme();
  return {
    headerStyle: { backgroundColor: tokens.panel },
    headerTintColor: tokens.heading,
    headerTitleStyle: { color: tokens.heading },
    headerBackButtonDisplayMode: "minimal",
    contentStyle: { backgroundColor: tokens.background },
  };
}
