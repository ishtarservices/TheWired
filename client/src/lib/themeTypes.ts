// ─── Theme Engine Types ──────────────────────────────────────────────

export interface CoreColors {
  background: string; // HSL string e.g. "220 14% 8%"
  foreground: string; // HSL string e.g. "220 14% 92%"
  primary: string;    // HSL string e.g. "235 55% 58%"
}

export interface ThemeFont {
  family: string;
  url?: string;       // .woff2 / Google Fonts URL
  weight?: string;    // e.g. "300 700"
}

export interface ThemeBackground {
  url: string;
  mode: "cover" | "tile";
  blurhash?: string;
  mimeType?: string;
}

export interface ThemeConfig {
  title: string;
  colors: CoreColors;
  font?: ThemeFont;
  background?: ThemeBackground;
}

export interface ThemePreset extends ThemeConfig {
  key: string;
  emoji: string;
  featured?: boolean;
  category?: "minimal" | "atmospheric" | "expressive" | "nostalgic" | "nature";
}

export interface DerivedTokens {
  // Backgrounds
  background: string;
  panel: string;
  card: string;
  cardHover: string;
  field: string;
  popover: string;
  surface: string;
  surfaceHover: string;

  // Text
  heading: string;
  body: string;
  soft: string;
  muted: string;
  faint: string;

  // Primary accent
  primary: string;
  primarySoft: string;
  primaryDim: string;
  primaryForeground: string;

  // Borders
  border: string;
  borderLight: string;

  // Semantic
  ring: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  warning: string;
}

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeState {
  mode: ThemeMode;
  preset: string;
  config: ThemeConfig;
  presetKeys: string[];
  featuredKeys: string[];
}

export interface ThemeActions {
  setMode: (mode: ThemeMode) => void;
  setPreset: (key: string) => void;
  setCustomColors: (colors: CoreColors) => void;
  setCustomFont: (font: ThemeFont | null) => void;
  setCustomBackground: (bg: ThemeBackground | null) => void;
  cyclePreset: (direction: 1 | -1) => void;
}
