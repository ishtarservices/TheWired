// ─── App-level (pre-login) preferences ───────────────────────────────
// Tiny, non-secret values that must be readable before any account or
// storage is open — today the theme preset. Backed by SecureStore purely
// because it's the only persistence wired this early; W2 moves this onto
// the SQLite StorageAdapter's app-global store (the guest marker in
// auth/session.ts migrates the same way).

import * as SecureStore from "expo-secure-store";

const THEME_PRESET_KEY = "prefs.themePreset";

export async function getStoredThemePreset(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(THEME_PRESET_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function storeThemePreset(key: string): void {
  SecureStore.setItemAsync(THEME_PRESET_KEY, key).catch(() => {});
}
