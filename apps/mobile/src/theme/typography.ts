// ─── Type scale ──────────────────────────────────────────────────────
// One set of typographic roles for the whole app (W1 design system). Roles,
// not ad-hoc sizes: screens compose <Type role="…"> (components/ui/Type.tsx)
// so the scale can evolve in one place. Each role speaks one of three voices:
//   body    — the preset's font family (ThemeConfig.font.family)
//   display — the preset's displayFamily (falls back to family)
//   meta    — the protocol voice: JetBrains Mono once loaded, the platform
//             mono stack until then. Timestamps, counts, ids, mode badges —
//             anything where the network is reporting, not a human speaking.

import { Platform, type TextStyle } from "react-native";
import type { ThemeFont } from "./types";

export type TypeRole =
  | "display" // screen-title moments, big confident numerals (Coinbase scale)
  | "title" // card/section titles
  | "headline" // row titles, emphasized body
  | "body" // default copy
  | "caption" // secondary meta
  | "micro" // smallest labels (pills, dense chrome)
  | "meta" // protocol voice: timestamps, counts, relay/status text
  | "metaLabel" // protocol voice, tracked-out section/mode labels
  | "mono" // keys, npubs, ids
  | "monoLg"; // emphasized mono (identity card)

export type FontWeightKey = 400 | 500 | 600 | 700;

type Voice = "body" | "display" | "meta";

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

/** The meta voice loads regular + medium only; heavier weights clamp to 500. */
const JETBRAINS_MONO: Record<400 | 500, string> = {
  400: "JetBrainsMono_400Regular",
  500: "JetBrainsMono_500Medium",
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

/** Meta-voice family: platform mono stack until fonts load, JetBrains after. */
export function resolveMonoFamily(weight: FontWeightKey): string | undefined {
  if (!fontsReady) return MONO_FONT;
  return JETBRAINS_MONO[weight >= 500 ? 500 : 400];
}

interface RoleSpec {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  weight: FontWeightKey;
  voice?: Voice; // default "body"
}

/** The scale. Display sits in the 28–34pt "large confident" band; the meta
 *  roles carry ~0.08em tracking so the mono voice reads as labeling. */
const ROLE_SPECS: Record<TypeRole, RoleSpec> = {
  display: { fontSize: 32, lineHeight: 38, letterSpacing: -0.8, weight: 700, voice: "display" },
  title: { fontSize: 22, lineHeight: 28, letterSpacing: -0.4, weight: 600, voice: "display" },
  headline: { fontSize: 17, lineHeight: 22, letterSpacing: -0.2, weight: 600 },
  body: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: 400 },
  caption: { fontSize: 13, lineHeight: 17, letterSpacing: 0, weight: 400 },
  micro: { fontSize: 11, lineHeight: 14, letterSpacing: 0.1, weight: 500 },
  meta: { fontSize: 11, lineHeight: 15, letterSpacing: 0.9, weight: 400, voice: "meta" },
  metaLabel: { fontSize: 10, lineHeight: 14, letterSpacing: 0.8, weight: 500, voice: "meta" },
  mono: { fontSize: 13, lineHeight: 18, letterSpacing: 0, weight: 400, voice: "meta" },
  monoLg: { fontSize: 15, lineHeight: 21, letterSpacing: 0, weight: 500, voice: "meta" },
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
  font: ThemeFont | undefined,
  options: TypeStyleOptions = {},
): TextStyle {
  const spec = ROLE_SPECS[role];
  const voice = spec.voice ?? "body";
  const weight = options.weight ?? spec.weight;

  let family: string | undefined;
  if (voice === "meta") {
    family = resolveMonoFamily(weight);
  } else {
    const presetFamily = voice === "display" ? (font?.displayFamily ?? font?.family) : font?.family;
    family = resolveFontFamily(presetFamily, weight);
  }

  const style: TextStyle = {
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    letterSpacing: spec.letterSpacing,
    fontFamily: family,
  };
  // Custom font files carry their weight in the family name; the system font
  // (and the fallback mono stack) still needs fontWeight.
  if (!family || family === MONO_FONT) {
    style.fontWeight = String(weight) as TextStyle["fontWeight"];
  }
  if (options.tabular) {
    style.fontVariant = ["tabular-nums"];
  }
  return style;
}

/** All font assets App.tsx must load (kept next to the map they feed). */
export { ROLE_SPECS as TYPE_ROLE_SPECS };
