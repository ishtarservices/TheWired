// ─── Theme Presets ───────────────────────────────────────────────────

import type { ThemePreset } from "./themeTypes";

export const PRESETS: Record<string, ThemePreset> = {
  // ─── Featured ────────────────────────────────────────────────────

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
    emoji: "\u2600\uFE0F",
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
    emoji: "\u26A1",
    category: "expressive",
    featured: true,
    colors: {
      background: "225 20% 2%",
      foreground: "213 27% 95%",
      primary: "258 70% 60%",
    },
    font: { family: "Space Grotesk", weight: "300 700" },
  },
  midnight: {
    key: "midnight",
    title: "Midnight",
    emoji: "\u{1F303}",
    category: "atmospheric",
    featured: true,
    colors: {
      background: "230 20% 6%",
      foreground: "210 20% 92%",
      primary: "200 80% 55%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  forest: {
    key: "forest",
    title: "Forest",
    emoji: "\u{1F332}",
    category: "nature",
    featured: true,
    colors: {
      background: "150 20% 8%",
      foreground: "140 15% 85%",
      primary: "155 60% 42%",
    },
    font: { family: "Merriweather" },
  },
  ocean: {
    key: "ocean",
    title: "Ocean",
    emoji: "\u{1F30A}",
    category: "nature",
    featured: true,
    colors: {
      background: "195 25% 8%",
      foreground: "190 20% 90%",
      primary: "185 65% 50%",
    },
    font: { family: "Nunito" },
  },
  sunset: {
    key: "sunset",
    title: "Sunset",
    emoji: "\u{1F305}",
    category: "atmospheric",
    featured: true,
    colors: {
      background: "30 20% 95%",
      foreground: "25 30% 18%",
      primary: "12 70% 55%",
    },
    font: { family: "Lora" },
  },
  sakura: {
    key: "sakura",
    title: "Sakura",
    emoji: "\u{1F338}",
    category: "expressive",
    featured: true,
    colors: {
      background: "340 25% 94%",
      foreground: "340 20% 20%",
      primary: "340 60% 55%",
    },
    font: { family: "Comfortaa" },
  },
  retro: {
    key: "retro",
    title: "Retro",
    emoji: "\u{1F4BF}",
    category: "nostalgic",
    featured: true,
    colors: {
      background: "40 30% 92%",
      foreground: "220 15% 15%",
      primary: "220 65% 50%",
    },
    font: { family: "Silkscreen" },
  },
  galaxy: {
    key: "galaxy",
    title: "Galaxy",
    emoji: "\u{1F30C}",
    category: "atmospheric",
    featured: true,
    colors: {
      background: "270 25% 6%",
      foreground: "260 15% 90%",
      primary: "270 65% 58%",
    },
    font: { family: "DM Sans" },
  },

  // ─── Additional ──────────────────────────────────────────────────

  slate: {
    key: "slate",
    title: "Slate",
    emoji: "\u{1FAA8}",
    category: "minimal",
    colors: {
      background: "215 16% 12%",
      foreground: "215 16% 88%",
      primary: "215 50% 50%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  warm: {
    key: "warm",
    title: "Warm",
    emoji: "\u{1F56F}\uFE0F",
    category: "minimal",
    colors: {
      background: "30 12% 10%",
      foreground: "30 12% 88%",
      primary: "30 55% 52%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  terminal: {
    key: "terminal",
    title: "Terminal",
    emoji: ">_",
    category: "nostalgic",
    colors: {
      background: "0 0% 4%",
      foreground: "120 80% 65%",
      primary: "120 80% 45%",
    },
    font: { family: "JetBrains Mono" },
  },
  gamer: {
    key: "gamer",
    title: "Gamer",
    emoji: "\u{1F3AE}",
    category: "expressive",
    colors: {
      background: "260 15% 5%",
      foreground: "0 0% 92%",
      primary: "280 80% 55%",
    },
    font: { family: "Rajdhani" },
  },
  cottage: {
    key: "cottage",
    title: "Cottage",
    emoji: "\u{1F3E1}",
    category: "nature",
    colors: {
      background: "35 25% 93%",
      foreground: "35 20% 18%",
      primary: "85 40% 42%",
    },
    font: { family: "Lora" },
  },
  sky: {
    key: "sky",
    title: "Sky",
    emoji: "\u2601\uFE0F",
    category: "nature",
    colors: {
      background: "205 30% 95%",
      foreground: "210 20% 15%",
      primary: "205 75% 48%",
    },
    font: { family: "Nunito" },
  },
  grunge: {
    key: "grunge",
    title: "Grunge",
    emoji: "\u{1F5A4}",
    category: "expressive",
    colors: {
      background: "0 0% 7%",
      foreground: "0 0% 80%",
      primary: "0 50% 48%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
  paper: {
    key: "paper",
    title: "Paper",
    emoji: "\u{1F4DD}",
    category: "minimal",
    colors: {
      background: "45 20% 96%",
      foreground: "45 10% 12%",
      primary: "220 50% 45%",
    },
    font: { family: "Lora" },
  },
  vapor: {
    key: "vapor",
    title: "Vaporwave",
    emoji: "\u{1F334}",
    category: "nostalgic",
    colors: {
      background: "280 15% 8%",
      foreground: "300 20% 88%",
      primary: "300 70% 60%",
    },
    font: { family: "DM Sans" },
  },
  monochrome: {
    key: "monochrome",
    title: "Monochrome",
    emoji: "\u25FC\uFE0F",
    category: "minimal",
    colors: {
      background: "0 0% 8%",
      foreground: "0 0% 88%",
      primary: "0 0% 55%",
    },
    font: { family: "Inter", weight: "300 700" },
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const FEATURED_KEYS = PRESET_KEYS.filter((k) => PRESETS[k].featured);
export const DEFAULT_PRESET = "clean-dark";

export function getPreset(key: string): ThemePreset | undefined {
  return PRESETS[key];
}

export function getPresetsByCategory(category: string): ThemePreset[] {
  return Object.values(PRESETS).filter((p) => p.category === category);
}

export const CATEGORIES = ["minimal", "atmospheric", "expressive", "nostalgic", "nature"] as const;
