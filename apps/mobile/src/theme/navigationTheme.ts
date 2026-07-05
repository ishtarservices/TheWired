// Bridges the derived theme tokens into React Navigation's Theme so native
// headers, the tab bar and screen backgrounds match the active preset.

import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";

import type { DerivedTokens } from "./types";

export function toNavigationTheme(tokens: DerivedTokens, isDark: boolean): Theme {
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: isDark,
    colors: {
      ...base.colors,
      primary: tokens.primary,
      background: tokens.background,
      card: tokens.panel,
      text: tokens.heading,
      border: tokens.border,
      notification: tokens.destructive,
    },
  };
}
