// ─── Theme Engine: HSL manipulation + token derivation ───────────────
// Ported from client/src/lib/themeEngine.ts. Same derivation math; the one
// deliberate difference is color emission: RN's color parser wants the legacy
// comma syntax (`hsl(h, s%, l%)` / `hsla(…)`), not CSS Color 4 space syntax.
// The CSS-injection half of the desktop engine is replaced by NativeWind
// vars() in ThemeContext.

import type { DerivedTokens, DerivedExtras } from "./types";

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

function toHSLParams(hsl: HSL): HSL {
  return {
    h: Math.round(hsl.h),
    s: Math.round(hsl.s * 10) / 10,
    l: Math.round(hsl.l * 10) / 10,
  };
}

/** Shift lightness by delta (clamped 0-100), returned as an RN color. */
export function shiftL(hsl: HSL, delta: number): string {
  return toCSS_(toHSLParams({ ...hsl, l: Math.max(0, Math.min(100, hsl.l + delta)) }));
}

/** Linear interpolation of lightness between two HSL values, as an RN color. */
export function lerpL(from: HSL, to: HSL, t: number): string {
  return toCSS_(
    toHSLParams({ h: from.h, s: from.s, l: from.l + (to.l - from.l) * t }),
  );
}

function toCSS_(hsl: HSL): string {
  return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

/** Raw HSL params ("220 14% 8%") → RN color string. */
export function toCSS(hsl: string): string {
  return toCSS_(parseHSL(hsl));
}

/** Raw HSL params + alpha → RN color string. */
export function withAlpha(hsl: string, alpha: number): string {
  const p = parseHSL(hsl);
  return `hsla(${p.h}, ${p.s}%, ${p.l}%, ${alpha})`;
}

function withAlphaHSL(hsl: HSL, alpha: number): string {
  return `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${alpha})`;
}

/** Adjust a fixed semantic color to match theme lightness. */
function adjustToTheme(hsl: string, isDark: boolean): string {
  const parsed = parseHSL(hsl);
  if (isDark) {
    return toCSS_({ ...parsed, l: Math.min(65, parsed.l + 5) });
  }
  return toCSS_({ ...parsed, l: Math.max(35, parsed.l - 5) });
}

/** Determine if a color set represents a dark theme. */
export function isDarkTheme(bg: string): boolean {
  return parseHSL(bg).l < 50;
}

// ─── Token Derivation (same math as desktop deriveTokens) ────────────

export function deriveTokens(bg: string, fg: string, primary: string): DerivedTokens {
  const bgHSL = parseHSL(bg);
  const fgHSL = parseHSL(fg);
  const priHSL = parseHSL(primary);
  const isDark = bgHSL.l < 50;

  // Direction: lighter or darker from background
  const dir = isDark ? 1 : -1;

  return {
    background: toCSS(bg),
    panel: shiftL(bgHSL, dir * 3),
    card: shiftL(bgHSL, dir * 6),
    cardHover: shiftL(bgHSL, dir * 9),
    field: shiftL(bgHSL, dir * 4),
    popover: shiftL(bgHSL, dir * 3),
    surface: withAlphaHSL(fgHSL, 0.03),
    surfaceHover: withAlphaHSL(fgHSL, 0.06),

    heading: toCSS(fg),
    body: lerpL(fgHSL, bgHSL, 0.15),
    soft: lerpL(fgHSL, bgHSL, 0.3),
    muted: lerpL(fgHSL, bgHSL, 0.5),
    faint: lerpL(fgHSL, bgHSL, 0.65),

    primary: toCSS(primary),
    primarySoft: shiftL(priHSL, 10),
    primaryDim: withAlphaHSL(priHSL, 0.15),
    primaryForeground: priHSL.l > 60 ? "hsl(0, 0%, 5%)" : "hsl(0, 0%, 100%)",

    border: lerpL(bgHSL, fgHSL, 0.15),
    borderLight: lerpL(bgHSL, fgHSL, 0.1),

    ring: withAlphaHSL(priHSL, 0.5),
    destructive: adjustToTheme("0 72% 51%", isDark),
    destructiveForeground: "hsl(0, 0%, 100%)",
    success: adjustToTheme("142 71% 45%", isDark),
    warning: adjustToTheme("38 92% 50%", isDark),
  };
}

/** Non-token derived values (desktop applyDerivedVars equivalent). */
export function deriveExtras(bg: string, primary: string, isDark: boolean): DerivedExtras {
  const bgHSL = parseHSL(bg);
  const priHSL = parseHSL(primary);

  return {
    glassBg: isDark ? withAlphaHSL(bgHSL, 0.82) : "hsla(0, 0%, 100%, 0.85)",
    glassBorder: withAlphaHSL(priHSL, 0.06),
    ambient1: withAlphaHSL(priHSL, 0.06),
    ambient2: withAlphaHSL(priHSL, 0.04),
    primaryBorder: withAlphaHSL(priHSL, 0.1),
    primaryBorderActive: withAlphaHSL(priHSL, 0.25),
  };
}
