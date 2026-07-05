// ─── Theme Presets ───────────────────────────────────────────────────
// Foundation subset of the desktop's 14 presets (client/src/lib/themePresets.ts):
// clean-dark, clean-light, neon. Port the remaining 11 verbatim when the
// theme settings screen lands — the engine already handles any preset.
//
// Fonts are declared for parity but not loaded yet (expo-font later); the
// foundation renders with the platform font.

import type { ThemePreset } from "./types";

export const PRESETS: Record<string, ThemePreset> = {
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
  "clean-dark": 0.5,
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
export const DEFAULT_PRESET = "clean-dark";

export function getPreset(key: string): ThemePreset | undefined {
  return PRESETS[key];
}
