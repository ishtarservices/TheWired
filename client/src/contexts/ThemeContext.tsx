import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type {
  ThemeMode,
  ThemeConfig,
  CoreColors,
  ThemeFont,
  ThemeBackground,
} from "../lib/themeTypes";
import { deriveTokens, applyTokens, applyDerivedVars, applyFont, isDarkTheme } from "../lib/themeEngine";
import { loadThemeFont, unloadFont } from "../lib/fontLoader";
import { PRESETS, PRESET_KEYS, FEATURED_KEYS, DEFAULT_PRESET } from "../lib/themePresets";

// ─── Storage Keys ────────────────────────────────────────────────────

const STORAGE_PRESET = "thewired_theme";
const STORAGE_MODE = "thewired_theme_mode";
const STORAGE_CUSTOM = "thewired_custom_theme";

// ─── Motion Intensity per-preset ─────────────────────────────────────

const MOTION_INTENSITY: Record<string, number> = {
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

// ─── Context Types ───────────────────────────────────────────────────

interface ThemeContextValue {
  // State
  mode: ThemeMode;
  preset: string;
  config: ThemeConfig;
  presetKeys: string[];
  featuredKeys: string[];
  isDark: boolean;

  // Legacy compat
  theme: "dark" | "light";
  toggleTheme: () => void;

  // Actions
  setMode: (mode: ThemeMode) => void;
  setPreset: (key: string) => void;
  setTheme: (t: "dark" | "light") => void;
  setCustomColors: (colors: CoreColors) => void;
  setCustomFont: (font: ThemeFont | null) => void;
  setCustomBackground: (bg: ThemeBackground | null) => void;
  cyclePreset: (direction: 1 | -1) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─── Helpers ─────────────────────────────────────────────────────────

function loadStoredPreset(): string {
  try {
    const stored = localStorage.getItem(STORAGE_PRESET);
    // Migrate old "dark"/"light" values
    if (stored === "dark") return "clean-dark";
    if (stored === "light") return "clean-light";
    if (stored && (PRESETS[stored] || stored === "custom")) return stored;
  } catch { /* ignore */ }
  return DEFAULT_PRESET;
}

function loadStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_MODE);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch { /* ignore */ }
  return "dark";
}

function loadCustomConfig(): ThemeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOM);
    if (raw) return JSON.parse(raw) as ThemeConfig;
  } catch { /* ignore */ }
  return null;
}

function resolveConfig(preset: string): ThemeConfig {
  if (preset === "custom") {
    const custom = loadCustomConfig();
    if (custom) return custom;
  }
  return PRESETS[preset] || PRESETS[DEFAULT_PRESET];
}

// ─── Provider ────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<string>(loadStoredPreset);
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode);
  const [config, setConfig] = useState<ThemeConfig>(() => resolveConfig(loadStoredPreset()));
  const [prevFontFamily, setPrevFontFamily] = useState<string>("");

  const isDark = isDarkTheme(config.colors.background);

  // Apply theme whenever config changes
  useEffect(() => {
    const tokens = deriveTokens(
      config.colors.background,
      config.colors.foreground,
      config.colors.primary,
    );
    applyTokens(tokens);

    const motionIntensity = MOTION_INTENSITY[preset] ?? 0.5;
    applyDerivedVars(config.colors.background, config.colors.primary, isDark, motionIntensity);

    // Font loading
    if (prevFontFamily && prevFontFamily !== config.font?.family) {
      unloadFont(prevFontFamily);
    }
    const family = loadThemeFont(config.font);
    applyFont(family);
    setPrevFontFamily(family);

    // Persist
    localStorage.setItem(STORAGE_PRESET, preset);
    localStorage.setItem(STORAGE_MODE, mode);
    if (preset === "custom") {
      localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(config));
    }
  }, [config, preset, mode, isDark]);

  // System theme change listener
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      // Re-resolve when system preference changes
      setConfig(resolveConfig(preset));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode, preset]);

  // ─── Actions ─────────────────────────────────────────────────────

  const setPreset = useCallback((key: string) => {
    setPresetState(key);
    const newConfig = resolveConfig(key);
    setConfig(newConfig);
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
  }, []);

  const setCustomColors = useCallback((colors: CoreColors) => {
    setPresetState("custom");
    setConfig((prev) => ({ ...prev, colors, title: "Custom" }));
  }, []);

  const setCustomFont = useCallback((font: ThemeFont | null) => {
    setPresetState("custom");
    setConfig((prev) => ({
      ...prev,
      font: font ?? undefined,
      title: "Custom",
    }));
  }, []);

  const setCustomBackground = useCallback((bg: ThemeBackground | null) => {
    setPresetState("custom");
    setConfig((prev) => ({
      ...prev,
      background: bg ?? undefined,
      title: "Custom",
    }));
  }, []);

  const cyclePreset = useCallback(
    (direction: 1 | -1) => {
      const idx = FEATURED_KEYS.indexOf(preset);
      const nextIdx =
        (idx + direction + FEATURED_KEYS.length) % FEATURED_KEYS.length;
      setPreset(FEATURED_KEYS[nextIdx]);
    },
    [preset, setPreset],
  );

  // Legacy compat
  const theme = isDark ? ("dark" as const) : ("light" as const);
  const toggleTheme = useCallback(() => {
    if (isDark) {
      setPreset("clean-light");
      setModeState("light");
    } else {
      setPreset("clean-dark");
      setModeState("dark");
    }
  }, [isDark, setPreset]);

  const setTheme = useCallback(
    (t: "dark" | "light") => {
      if (t === "dark") {
        setPreset("clean-dark");
        setModeState("dark");
      } else {
        setPreset("clean-light");
        setModeState("light");
      }
    },
    [setPreset],
  );

  return (
    <ThemeContext.Provider
      value={{
        mode,
        preset,
        config,
        presetKeys: PRESET_KEYS,
        featuredKeys: FEATURED_KEYS,
        isDark,
        theme,
        toggleTheme,
        setMode,
        setPreset,
        setTheme,
        setCustomColors,
        setCustomFont,
        setCustomBackground,
        cyclePreset,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
