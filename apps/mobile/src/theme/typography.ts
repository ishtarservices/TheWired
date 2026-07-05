// ─── Type scale ──────────────────────────────────────────────────────
// One set of typographic roles for the whole app (W1 design system). Roles,
// not ad-hoc sizes: screens compose <Type role="…"> (components/ui/Type.tsx)
// so the scale can evolve in one place. The font *family* comes from the
// active preset (ThemeConfig.font — same contract as desktop themePresets),
// resolved here to the concrete @expo-google-fonts asset names.

import { Platform, type TextStyle } from "react-native";

export type TypeRole =
  | "display" // screen-title moments, big confident numerals (Coinbase scale)
  | "title" // card/section titles
  | "headline" // row titles, emphasized body
  | "body" // default copy
  | "caption" // secondary meta
  | "micro" // smallest labels (tab bar, pills)
  | "mono" // keys, npubs, ids
  | "monoLg"; // emphasized mono (identity card)

export type FontWeightKey = 400 | 500 | 600 | 700;

/** Platform mono stacks — system-provided, no font download needed. */
export const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

/**
 * Preset font family → the static @expo-google-fonts asset registered for
 * each weight. RN registers each weight as its own family name, so
 * (family, weight) resolves to one concrete string. Families not listed
 * here render with the system font (weight via fontWeight instead).
 */
const GOOGLE_FONTS: Record<string, Record<FontWeightKey, string>> = {
  Inter: {
    400: "Inter_400Regular",
    500: "Inter_500Medium",
    600: "Inter_600SemiBold",
    700: "Inter_700Bold",
  },
  "Space Grotesk": {
    400: "SpaceGrotesk_400Regular",
    500: "SpaceGrotesk_500Medium",
    600: "SpaceGrotesk_600SemiBold",
    700: "SpaceGrotesk_700Bold",
  },
};

// App.tsx flips this once useFonts resolves; until then (or if loading
// failed) we resolve to the system font so iOS never sees an unregistered
// fontFamily (which redboxes in dev).
let fontsReady = false;
export function setFontsReady(ready: boolean): void {
  fontsReady = ready;
}

/**
 * Resolve (preset family, weight) → concrete fontFamily, or undefined for
 * the system font. Pure given the module flag — unit-testable.
 */
export function resolveFontFamily(
  family: string | undefined,
  weight: FontWeightKey,
): string | undefined {
  if (!family || !fontsReady) return undefined;
  return GOOGLE_FONTS[family]?.[weight];
}

interface RoleSpec {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  weight: FontWeightKey;
  mono?: boolean;
}

/** The scale. Display sits in the 28–34pt "large confident" band. */
const ROLE_SPECS: Record<TypeRole, RoleSpec> = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -0.8, weight: 700 },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.4, weight: 600 },
  headline: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2, weight: 600 },
  body: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: 400 },
  caption: { fontSize: 13, lineHeight: 17, letterSpacing: 0, weight: 400 },
  micro: { fontSize: 11, lineHeight: 14, letterSpacing: 0.1, weight: 500 },
  mono: { fontSize: 13, lineHeight: 18, letterSpacing: 0, weight: 400, mono: true },
  monoLg: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: 500, mono: true },
};

export interface TypeStyleOptions {
  /** Tabular figures — counts, balances, timers (no layout shift as digits tick). */
  tabular?: boolean;
  /** Override the role's default weight. */
  weight?: FontWeightKey;
}

/** Compose the TextStyle for a role under the active preset font. */
export function typeStyle(
  role: TypeRole,
  presetFamily: string | undefined,
  options: TypeStyleOptions = {},
): TextStyle {
  const spec = ROLE_SPECS[role];
  const weight = options.weight ?? spec.weight;
  const family = spec.mono ? MONO_FONT : resolveFontFamily(presetFamily, weight);

  const style: TextStyle = {
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
    fontFamily: family,
  };
  // Custom font files carry their weight in the family name; the system font
  // (and the mono stack) still needs fontWeight.
  if (!family || spec.mono) {
    style.fontWeight = String(weight) as TextStyle["fontWeight"];
  }
  if (options.tabular) {
    style.fontVariant = ["tabular-nums"];
  }
  return style;
}

/** All font assets App.tsx must load (kept next to the map they feed). */
export { ROLE_SPECS as TYPE_ROLE_SPECS };
