// ─── Theme Presets ───────────────────────────────────────────────────
// signal — the mobile default: pure monochrome (all three core colors at
// S=0, the engine's lightness-only derivation produces a neutral ramp), the
// accent IS the inversion (white fill, near-black text), muted semantics,
// film grain, and the two-voice type system (Space Grotesk display over
// Inter body; the meta roles carry JetBrains Mono independent of preset).
// Plus a foundation subset of the desktop's 14 presets
// (client/src/lib/themePresets.ts): clean-dark, clean-light, neon — and
// wired-black, a mobile-first true-black OLED variant of clean-dark. Port the
// remaining desktop presets verbatim when the theme settings screen grows —
// the engine handles any preset.
//
// Fonts load via expo-font in App.tsx; typography.ts resolves each preset's
// family to the loaded weights (system font until then).

import type { ThemePreset } from "./types";

export const PRESETS: Record<string, ThemePreset> = {
  signal: {
    key: "signal",
    title: "Signal",
    emoji: "\u{25FE}",
    category: "minimal",
    featured: true,
    colors: {
      background: "0 0% 4%", // #0a0a0a
      foreground: "0 0% 95%",
      primary: "0 0% 100%", // the accent is the inversion
    },
    font: { family: "Inter", displayFamily: "Space Grotesk", weight: "300 700" },
    semantics: "muted",
    grain: true,
  },
  "clean-dark": {
    key: "clean-dark",
    title: "Clean Dark",
    emoji: "\u{1F311}",
    category: "minimal",
    featured: true,
    colors: {
      background: "220 14% 8%",
      foreground: "220 14% 92%",
      primary: "235 55% 58%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  "wired-black": {
    key: "wired-black",
    title: "Wired Black",
    emoji: "\u{26AB}",
    category: "minimal",
    featured: true,
    colors: {
      background: "225 15% 0%",
      foreground: "220 14% 92%",
      primary: "235 70% 63%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  "clean-light": {
    key: "clean-light",
    title: "Clean Light",
    emoji: "☀️",
    category: "minimal",
    featured: true,
    colors: {
      background: "220 14% 97%",
      foreground: "220 14% 10%",
      primary: "235 55% 52%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  neon: {
    key: "neon",
    title: "Neon",
    emoji: "⚡",
    category: "expressive",
    featured: true,
    colors: {
      background: "225 20% 2%",
      foreground: "213 27% 95%",
      primary: "258 70% 60%",
    },
    font: { family: "Space Grotesk", weight: "300 700" },
  },
};

/**
 * Per-preset motion intensity (0 = none, 0.5 = subtle, 1 = full) — gates
 * Reanimated animation amplitude the way desktop scales its glow/transition
 * CSS. Full 14-key map kept so ported presets pick up their value for free.
 */
export const MOTION_INTENSITY: Record<string, number> = {
  signal: 0.5,
  "clean-dark": 0.5,
  "wired-black": 0.5,
  "clean-light": 0.5,
  neon: 1.0,
  midnight: 0.7,
  forest: 0.5,
  ocean: 0.6,
  sunset: 0.4,
  sakura: 0.5,
  retro: 0.3,
  galaxy: 0.8,
  paper: 0.2,
  terminal: 0.8,
  gamer: 1.0,
  monochrome: 0.3,
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const FEATURED_KEYS = PRESET_KEYS.filter((k) => PRESETS[k].featured);
export const DEFAULT_PRESET = "signal";

export function getPreset(key: string): ThemePreset | undefined {
  return PRESETS[key];
}
