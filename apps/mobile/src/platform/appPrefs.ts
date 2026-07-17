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
const SPACES_SELECTION_KEY = "prefs.spacesSelection";
const FEED_SCOPE_KEY = "prefs.feedScope";

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

/** Last SpacesHome switcher selection, as JSON (screens/spaces/
 *  spacesSelection.ts owns the shape + guards). App-global like the preset —
 *  a stale space from another account collapses to feed in the screen. */
export async function getStoredSpacesSelection(): Promise<string | null> {
  try {
    if (!storage) return null;
    const stored = await storage.getAppStore<string>("user_state").get(SPACES_SELECTION_KEY);
    return stored ?? null;
  } catch {
    return null;
  }
}

export function storeSpacesSelection(json: string): void {
  storage?.getAppStore<string>("user_state").put(SPACES_SELECTION_KEY, json).catch(() => {});
}

/** Last global/follows feed tab, as a bare string (screens/spaces/feedScope.ts
 *  owns the guard). App-global like the rest — a stale "follows" for a guest
 *  just shows the sign-in empty state. */
export async function getStoredFeedScope(): Promise<string | null> {
  try {
    if (!storage) return null;
    const stored = await storage.getAppStore<string>("user_state").get(FEED_SCOPE_KEY);
    return stored ?? null;
  } catch {
    return null;
  }
}

export function storeFeedScope(scope: string): void {
  storage?.getAppStore<string>("user_state").put(FEED_SCOPE_KEY, scope).catch(() => {});
}
