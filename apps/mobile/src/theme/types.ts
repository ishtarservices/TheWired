// ─── Theme Engine Types ──────────────────────────────────────────────
// Ported from client/src/lib/themeTypes.ts — keep the shapes identical so the
// engine can move into @thewired/core at Phase 0 without churn.
// Mobile-first additions not yet in the desktop shapes (port desktop-side
// when the signal preset lands there): ThemeFont.displayFamily,
// ThemeConfig.semantics, ThemeConfig.grain.

export interface CoreColors {
  background: string; // raw HSL params, e.g. "220 14% 8%"
  foreground: string; // e.g. "220 14% 92%"
  primary: string; // e.g. "235 55% 58%"
}

/** Semantic color treatment — "muted" desaturates destructive and
 *  near-achromatizes success/warning (monochrome presets). */
export type SemanticsMode = "full" | "muted";

export interface ThemeFont {
  family: string;
  /** Two-voice presets: display roles resolve here, falling back to family. */
  displayFamily?: string;
  url?: string;
  weight?: string; // e.g. "300 700"
}

export interface ThemeConfig {
  title: string;
  colors: CoreColors;
  font?: ThemeFont;
  semantics?: SemanticsMode;
  /** Film-grain canvas overlay (GrainOverlay) — texture presets only. */
  grain?: boolean;
}

export interface ThemePreset extends ThemeConfig {
  key: string;
  emoji: string;
  featured?: boolean;
  category?: "minimal" | "atmospheric" | "expressive" | "nostalgic" | "nature";
}

/** All color tokens derived from the 3 core colors — RN color strings. */
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

/** Non-token derived values (desktop sets these as extra CSS vars). */
export interface DerivedExtras {
  glassBg: string;
  glassBorder: string;
  ambient1: string;
  ambient2: string;
  primaryBorder: string;
  primaryBorderActive: string;
}
