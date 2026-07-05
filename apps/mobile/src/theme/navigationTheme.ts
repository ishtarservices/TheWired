// Bridges the derived theme tokens into React Navigation's Theme so native
// headers, the tab bar and screen backgrounds match the active preset.

import { DarkTheme, DefaultTheme, type Theme } from "@react-navigation/native";

import { resolveFontFamily } from "./typography";
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

/** React Navigation v7 theme fonts — headers/back labels follow the preset
 *  font. Weights the platform can't resolve fall back to the system font. */
export function navigationFonts(presetFamily: string | undefined): Theme["fonts"] {
  const regular = resolveFontFamily(presetFamily, 400);
  const medium = resolveFontFamily(presetFamily, 500);
  const bold = resolveFontFamily(presetFamily, 700);
  return {
    regular: regular
      ? { fontFamily: regular, fontWeight: "normal" }
      : { fontFamily: "System", fontWeight: "400" },
    medium: medium
      ? { fontFamily: medium, fontWeight: "normal" }
      : { fontFamily: "System", fontWeight: "500" },
    bold: bold
      ? { fontFamily: bold, fontWeight: "normal" }
      : { fontFamily: "System", fontWeight: "700" },
    heavy: bold
      ? { fontFamily: bold, fontWeight: "normal" }
      : { fontFamily: "System", fontWeight: "800" },
  };
}
