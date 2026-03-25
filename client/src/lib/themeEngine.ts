// ─── Theme Engine: HSL manipulation + token derivation + CSS injection ───

import type { DerivedTokens } from "./themeTypes";

// ─── HSL Parsing & Manipulation ──────────────────────────────────────

interface HSL {
  h: number;
  s: number;
  l: number;
}

export function parseHSL(hsl: string): HSL {
  const parts = hsl.trim().split(/\s+/);
  return {
    h: parseFloat(parts[0]) || 0,
    s: parseFloat(parts[1]) || 0,
    l: parseFloat(parts[2]) || 0,
  };
}

export function toHSLString(hsl: HSL): string {
  return `${Math.round(hsl.h)} ${Math.round(hsl.s * 10) / 10}% ${Math.round(hsl.l * 10) / 10}%`;
}

/** Shift lightness by delta (clamped 0-100) */
export function shiftL(hsl: HSL, delta: number): string {
  return toHSLString({
    ...hsl,
    l: Math.max(0, Math.min(100, hsl.l + delta)),
  });
}

/** Linear interpolation of lightness between two HSL values */
export function lerpL(from: HSL, to: HSL, t: number): string {
  return toHSLString({
    h: from.h,
    s: from.s,
    l: from.l + (to.l - from.l) * t,
  });
}

/** Wrap raw HSL params in hsl() for valid CSS */
export function toCSS(hsl: string): string {
  return `hsl(${hsl})`;
}

/** Returns hsl() with alpha for use in CSS */
export function withAlpha(hsl: string, alpha: number): string {
  return `hsl(${hsl} / ${alpha})`;
}

/** Adjust a fixed semantic color to match theme lightness */
function adjustToTheme(hsl: string, isDark: boolean): string {
  const parsed = parseHSL(hsl);
  if (isDark) {
    // For dark themes, lighten semantic colors slightly
    return toHSLString({ ...parsed, l: Math.min(65, parsed.l + 5) });
  }
  // For light themes, darken slightly
  return toHSLString({ ...parsed, l: Math.max(35, parsed.l - 5) });
}

// ─── Token Derivation ────────────────────────────────────────────────

export function deriveTokens(bg: string, fg: string, primary: string): DerivedTokens {
  const bgHSL = parseHSL(bg);
  const fgHSL = parseHSL(fg);
  const priHSL = parseHSL(primary);
  const isDark = bgHSL.l < 50;

  // Direction: lighter or darker from background
  const dir = isDark ? 1 : -1;

  return {
    background: toCSS(bg),
    panel: toCSS(shiftL(bgHSL, dir * 3)),
    card: toCSS(shiftL(bgHSL, dir * 6)),
    cardHover: toCSS(shiftL(bgHSL, dir * 9)),
    field: toCSS(shiftL(bgHSL, dir * 4)),
    popover: toCSS(shiftL(bgHSL, dir * 3)),
    surface: withAlpha(fg, 0.03),
    surfaceHover: withAlpha(fg, 0.06),

    heading: toCSS(fg),
    body: toCSS(lerpL(fgHSL, bgHSL, 0.15)),
    soft: toCSS(lerpL(fgHSL, bgHSL, 0.30)),
    muted: toCSS(lerpL(fgHSL, bgHSL, 0.50)),
    faint: toCSS(lerpL(fgHSL, bgHSL, 0.65)),

    primary: toCSS(primary),
    primarySoft: toCSS(shiftL(priHSL, 10)),
    primaryDim: withAlpha(primary, 0.15),
    primaryForeground: toCSS(priHSL.l > 60 ? "0 0% 5%" : "0 0% 100%"),

    border: toCSS(lerpL(bgHSL, fgHSL, 0.15)),
    borderLight: toCSS(lerpL(bgHSL, fgHSL, 0.10)),

    ring: withAlpha(primary, 0.5),
    destructive: toCSS(adjustToTheme("0 72% 51%", isDark)),
    destructiveForeground: toCSS("0 0% 100%"),
    success: toCSS(adjustToTheme("142 71% 45%", isDark)),
    warning: toCSS(adjustToTheme("38 92% 50%", isDark)),
  };
}

// ─── CSS Injection ───────────────────────────────────────────────────

const TOKEN_TO_CSS: Record<keyof DerivedTokens, string> = {
  background: "--color-background",
  panel: "--color-panel",
  card: "--color-card",
  cardHover: "--color-card-hover",
  field: "--color-field",
  popover: "--color-popover",
  surface: "--color-surface",
  surfaceHover: "--color-surface-hover",
  heading: "--color-heading",
  body: "--color-body",
  soft: "--color-soft",
  muted: "--color-muted",
  faint: "--color-faint",
  primary: "--color-primary",
  primarySoft: "--color-primary-soft",
  primaryDim: "--color-primary-dim",
  primaryForeground: "--color-primary-fg",
  border: "--color-border",
  borderLight: "--color-border-light",
  ring: "--color-ring",
  destructive: "--color-destructive",
  destructiveForeground: "--color-destructive-fg",
  success: "--color-success",
  warning: "--color-warning",
};

export function applyTokens(tokens: DerivedTokens): void {
  const root = document.documentElement.style;
  for (const [key, cssVar] of Object.entries(TOKEN_TO_CSS)) {
    const value = tokens[key as keyof DerivedTokens];
    root.setProperty(cssVar, value);
  }
}

/** Compute derived non-color CSS variables from the primary (raw HSL params) and bg (raw HSL params) */
export function applyDerivedVars(bg: string, primary: string, isDark: boolean, motionIntensity: number): void {
  const root = document.documentElement.style;

  // Glass
  root.setProperty("--glass-bg", isDark
    ? `hsl(${bg} / 0.82)`
    : `hsl(0 0% 100% / 0.85)`);
  root.setProperty("--glass-border", `hsl(${primary} / 0.06)`);

  // Glows (scaled by motion intensity)
  const glowAlpha = (base: number) => (base * motionIntensity).toFixed(2);
  root.setProperty("--glow-primary", `0 0 12px hsl(${primary} / ${glowAlpha(0.2)})`);
  root.setProperty("--glow-primary-strong", `0 0 20px hsl(${primary} / ${glowAlpha(0.3)}), 0 0 40px hsl(${primary} / ${glowAlpha(0.08)})`);

  // Shadows
  root.setProperty("--shadow-sm", isDark
    ? "0 1px 2px hsl(0 0% 0% / 0.05)"
    : "0 1px 2px hsl(0 0% 0% / 0.03)");
  root.setProperty("--shadow-md", isDark
    ? "0 2px 8px hsl(0 0% 0% / 0.12)"
    : "0 2px 8px hsl(0 0% 0% / 0.06)");
  root.setProperty("--shadow-lg", isDark
    ? "0 8px 24px hsl(0 0% 0% / 0.2)"
    : "0 8px 24px hsl(0 0% 0% / 0.1)");

  // Ambient (for bg-ambient gradient)
  root.setProperty("--ambient-1", `hsl(${primary} / 0.06)`);
  root.setProperty("--ambient-2", `hsl(${primary} / 0.04)`);
  root.setProperty("--ambient-3", `hsl(${primary} / 0.03)`);
  root.setProperty("--ambient-4", `hsl(${primary} / 0.02)`);
  root.setProperty("--grid-color", `hsl(${primary} / 0.02)`);

  // Primary border
  root.setProperty("--primary-border", `hsl(${primary} / 0.1)`);
  root.setProperty("--primary-border-hover", `hsl(${primary} / 0.25)`);

  // Inner glow
  root.setProperty("--card-inner-glow", `inset 0 1px 0 0 hsl(0 0% 100% / ${isDark ? 0.03 : 0.5})`);

  // Focus glow (for arbitrary shadow values)
  root.setProperty("--focus-glow-color", `hsl(${primary} / 0.1)`);

  // Motion intensity
  root.setProperty("--motion-intensity", String(motionIntensity));
}

export function applyFont(family: string): void {
  document.documentElement.style.setProperty("--font-family", `'${family}'`);
}

/** Determine if a color set represents a dark theme */
export function isDarkTheme(bg: string): boolean {
  return parseHSL(bg).l < 50;
}
