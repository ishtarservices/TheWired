// ─── Non-color design tokens ─────────────────────────────────────────
// Ported from the desktop's :root variables (client/src/index.css). These are
// theme-independent; the theme-dependent extras (glass/ambient colors) come
// from deriveExtras() in engine.ts.

import { Platform, type ViewStyle } from "react-native";

/** Radii — matches --radius-sm/md/lg/xl (also mirrored in tailwind.config.js). */
export const RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

/**
 * Z-index scale — matches --z-* on desktop. On mobile most layering is owned
 * by the navigation/modal stack; use these only for in-screen overlays.
 */
export const Z_INDEX = {
  base: 0,
  elevated: 10,
  sticky: 20,
  dropdown: 30,
  overlay: 40,
  modal: 50,
  toast: 60,
  lightbox: 100,
} as const;

/** Transition durations (ms) — matches --transition-fast/smooth/spring. */
export const DURATION = {
  fast: 150,
  smooth: 250,
  spring: 300,
} as const;

/**
 * Glass — desktop's backdrop-filter blur has no RN equivalent; when a glass
 * surface lands, use expo-blur with this intensity plus the glassBg overlay
 * color from deriveExtras().
 */
export const GLASS_BLUR_INTENSITY = 20;

/**
 * Shadows — matches --shadow-sm/md/lg/elevated (dark-theme values; light
 * themes use lower opacity on desktop, tune when a light preset ships).
 * Android relies on elevation.
 */
function shadow(opacity: number, radius: number, height: number, elevation: number): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation },
    default: {
      shadowColor: "#000",
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height },
    },
  })!;
}

export const SHADOWS = {
  sm: shadow(0.05, 2, 1, 1),
  md: shadow(0.12, 8, 2, 3),
  lg: shadow(0.2, 24, 8, 8),
  elevated: shadow(0.25, 40, 12, 12),
} as const;

/**
 * AI chart palette — static on desktop (@theme --chart-N, not preset-driven).
 * RN comma-syntax equivalents of the index.css values.
 */
export const CHART_COLORS = {
  1: "hsl(235, 65%, 64%)",
  2: "hsl(170, 65%, 48%)",
  3: "hsl(38, 92%, 58%)",
  4: "hsl(330, 70%, 64%)",
  5: "hsl(142, 60%, 52%)",
} as const;

/** Minimum touch target (pt) — Apple HIG / Android accessibility floor. */
export const MIN_TOUCH_TARGET = 44;
