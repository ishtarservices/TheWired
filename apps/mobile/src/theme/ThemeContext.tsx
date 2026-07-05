// ─── Runtime theme provider ──────────────────────────────────────────
// Mobile equivalent of client/src/contexts/ThemeContext.tsx. Where the desktop
// engine writes CSS variables onto document.documentElement, we build a
// NativeWind vars() style that App.tsx spreads on the root View — every
// className (bg-panel, text-soft, …) resolves through it, so switching presets
// restyles the whole app at runtime, no rebuild.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TextStyle } from "react-native";
import { vars } from "nativewind";

import { deriveExtras, deriveTokens, isDarkTheme } from "./engine";
import {
  DEFAULT_PRESET,
  FEATURED_KEYS,
  MOTION_INTENSITY,
  PRESETS,
  PRESET_KEYS,
} from "./presets";
import { CHART_COLORS } from "./constants";
import { typeStyle, type TypeRole, type TypeStyleOptions } from "./typography";
import type { DerivedExtras, DerivedTokens, ThemeConfig } from "./types";
import { storeThemePreset } from "@/platform/appPrefs";

// Same CSS-variable names as the desktop @theme block, so the Tailwind class
// vocabulary matches 1:1 (tailwind.config.js references these vars).
const TOKEN_TO_CSS_VAR: Record<keyof DerivedTokens, string> = {
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

interface ThemeContextValue {
  preset: string;
  config: ThemeConfig;
  /** Raw color strings — for props that can't take a className (navigator
   *  options, ActivityIndicator color, icon colors, …). */
  tokens: DerivedTokens;
  extras: DerivedExtras;
  isDark: boolean;
  /** 0–1, gates Reanimated animation amplitude per preset. */
  motionIntensity: number;
  presetKeys: string[];
  featuredKeys: string[];
  /** vars() style — App.tsx spreads this on the root View. */
  themeVars: ReturnType<typeof vars>;
  /** Type-scale style for a role under the active preset's font — for
   *  styles that can't come from a className (nav options, Type component). */
  type: (role: TypeRole, options?: TypeStyleOptions) => TextStyle;
  setPreset: (key: string) => void;
  cyclePreset: (direction: 1 | -1) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialPreset,
}: {
  children: ReactNode;
  /** Persisted preset read before first paint (App.tsx) — avoids a
   *  default-theme flash for users on another preset. */
  initialPreset?: string | null;
}) {
  const [preset, setPresetState] = useState<string>(() =>
    initialPreset && PRESETS[initialPreset] ? initialPreset : DEFAULT_PRESET,
  );

  const config: ThemeConfig = PRESETS[preset] ?? PRESETS[DEFAULT_PRESET];
  const isDark = isDarkTheme(config.colors.background);

  const tokens = useMemo(
    () =>
      deriveTokens(
        config.colors.background,
        config.colors.foreground,
        config.colors.primary,
      ),
    [config],
  );

  const extras = useMemo(
    () => deriveExtras(config.colors.background, config.colors.primary, isDark),
    [config, isDark],
  );

  const themeVars = useMemo(() => {
    const map: Record<string, string> = {};
    for (const key of Object.keys(TOKEN_TO_CSS_VAR) as (keyof DerivedTokens)[]) {
      map[TOKEN_TO_CSS_VAR[key]] = tokens[key];
    }
    for (const [n, color] of Object.entries(CHART_COLORS)) {
      map[`--chart-${n}`] = color;
    }
    return vars(map);
  }, [tokens]);

  const setPreset = useCallback((key: string) => {
    if (PRESETS[key]) {
      setPresetState(key);
      storeThemePreset(key);
    }
  }, []);

  const cyclePreset = useCallback(
    (direction: 1 | -1) => {
      setPresetState((prev) => {
        const idx = FEATURED_KEYS.indexOf(prev);
        const next =
          (idx + direction + FEATURED_KEYS.length) % FEATURED_KEYS.length;
        storeThemePreset(FEATURED_KEYS[next]);
        return FEATURED_KEYS[next];
      });
    },
    [],
  );

  const type = useCallback(
    (role: TypeRole, options?: TypeStyleOptions) =>
      typeStyle(role, config.font?.family, options),
    [config],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      preset,
      config,
      tokens,
      extras,
      isDark,
      motionIntensity: MOTION_INTENSITY[preset] ?? 0.5,
      presetKeys: PRESET_KEYS,
      featuredKeys: FEATURED_KEYS,
      themeVars,
      type,
      setPreset,
      cyclePreset,
    }),
    [preset, config, tokens, extras, isDark, themeVars, type, setPreset, cyclePreset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
