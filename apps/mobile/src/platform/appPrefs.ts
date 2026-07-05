// ─── App-level (pre-login) preferences ───────────────────────────────
// Tiny, non-secret values that must be readable before any account is open —
// today the theme preset. Backed by the SQLite app-global user_state store
// (W2; getAppStore, so an open account DB never captures it); reads fall
// back to — and migrate from — the W1 SecureStore location once. The guest
// marker stays in SecureStore: it gates auth and is read during session
// hydration (auth/session.ts).

import * as SecureStore from "expo-secure-store";

import type { MobileStorage } from "./adapters/sqliteStorage";

const THEME_PRESET_KEY = "prefs.themePreset";

let storage: MobileStorage | null = null;

/** Registered once at adapter creation (createMobileAdapters). */
export function initAppPrefs(adapter: MobileStorage): void {
  storage = adapter;
}

export async function getStoredThemePreset(): Promise<string | null> {
  try {
    if (storage) {
      const stored = await storage
        .getAppStore<string>("user_state")
        .get(THEME_PRESET_KEY);
      if (stored) return stored;
    }
    // W1 stored the preset in SecureStore — migrate it forward once.
    const legacy = await SecureStore.getItemAsync(THEME_PRESET_KEY);
    if (legacy && storage) {
      await storage.getAppStore<string>("user_state").put(THEME_PRESET_KEY, legacy);
      SecureStore.deleteItemAsync(THEME_PRESET_KEY).catch(() => {});
    }
    return legacy ?? null;
  } catch {
    return null;
  }
}

export function storeThemePreset(key: string): void {
  if (storage) {
    storage.getAppStore<string>("user_state").put(THEME_PRESET_KEY, key).catch(() => {});
  } else {
    SecureStore.setItemAsync(THEME_PRESET_KEY, key).catch(() => {});
  }
}
