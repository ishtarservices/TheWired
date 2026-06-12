/**
 * Per-account storage for transport credentials — the NIP-46 bunker connection,
 * the NWC wallet URI, and LLM / web-search API keys. These are NOT the identity
 * key.
 *
 * - Desktop (Tauri): OS keychain via the `keystore_*_secret` commands
 *   (non-biometric, so reconnect-on-launch and zap don't trigger Touch ID).
 * - Web: session memory by default — secrets die with the tab and are purged on
 *   logout. Persistence to localStorage is PLAINTEXT and same-origin-readable
 *   (any XSS exfiltrates every key), so it requires an explicit
 *   risk-acknowledged opt-in (Settings → Security) — audit #95.
 *
 * Keys embed the account pubkey, so storage is inherently account-scoped.
 */
import { TauriSigner } from "./tauriSigner";

const WEB_PREFIX = "thewired_secret_";
/** The opt-in flag itself is non-secret. Deliberately OUTSIDE the secret
 *  prefix namespace so prefix sweeps (purge/migrate) never treat it as one. */
const PERSIST_OPTIN_KEY = "thewired_persist_secrets_optin";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Web-only session cache; the sole storage when persistence is opted out. */
const sessionSecrets = new Map<string, string>();
let legacyMigrated = false;

/** True when secrets persist across sessions. Always true on desktop (OS
 *  keychain); on web only after the explicit opt-in. */
export function isSecretPersistEnabled(): boolean {
  if (isTauri()) return true;
  try {
    return localStorage.getItem(PERSIST_OPTIN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistedKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(WEB_PREFIX)) keys.push(k);
  }
  return keys;
}

/** Pre-opt-in builds wrote every secret to localStorage unconditionally. Absorb
 *  those entries into session memory (the current session keeps working) and
 *  remove the plaintext, unless the user has opted in to persistence. */
function migrateLegacyWebSecrets(): void {
  if (legacyMigrated) return;
  legacyMigrated = true;
  if (isSecretPersistEnabled()) return; // sanctioned by the opt-in
  try {
    for (const k of persistedKeys()) {
      const value = localStorage.getItem(k);
      const key = k.slice(WEB_PREFIX.length);
      if (value !== null && !sessionSecrets.has(key)) sessionSecrets.set(key, value);
      localStorage.removeItem(k);
    }
  } catch {
    /* storage unavailable */
  }
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await TauriSigner.setSecret(key, value);
    return;
  }
  migrateLegacyWebSecrets();
  sessionSecrets.set(key, value);
  if (isSecretPersistEnabled()) {
    try {
      localStorage.setItem(WEB_PREFIX + key, value);
    } catch {
      /* storage unavailable */
    }
  }
}

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri()) {
    return TauriSigner.getSecret(key);
  }
  migrateLegacyWebSecrets();
  const inMemory = sessionSecrets.get(key);
  if (inMemory !== undefined) return inMemory;
  if (!isSecretPersistEnabled()) return null;
  try {
    return localStorage.getItem(WEB_PREFIX + key);
  } catch {
    return null;
  }
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri()) {
    await TauriSigner.deleteSecret(key);
    return;
  }
  sessionSecrets.delete(key);
  try {
    localStorage.removeItem(WEB_PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

/** Toggle web persistence (no-op on desktop). Enabling flushes the session's
 *  secrets to localStorage; disabling pulls persisted entries back into session
 *  memory (so nothing breaks mid-session) and removes the plaintext. */
export function setSecretPersistEnabled(enabled: boolean): void {
  if (isTauri()) return;
  try {
    if (enabled) {
      localStorage.setItem(PERSIST_OPTIN_KEY, "1");
      for (const [key, value] of sessionSecrets) {
        localStorage.setItem(WEB_PREFIX + key, value);
      }
    } else {
      localStorage.removeItem(PERSIST_OPTIN_KEY);
      for (const k of persistedKeys()) {
        const value = localStorage.getItem(k);
        const key = k.slice(WEB_PREFIX.length);
        if (value !== null && !sessionSecrets.has(key)) sessionSecrets.set(key, value);
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* storage unavailable */
  }
}

/** Full-logout purge (web only): session memory AND any persisted entries.
 *  Desktop keychain entries survive logout by design (reconnect-on-relogin). */
export function purgeWebSecrets(): void {
  if (isTauri()) return;
  sessionSecrets.clear();
  try {
    for (const k of persistedKeys()) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/** Keychain key for a user's NIP-46 bunker connection blob (`{uri, clientSecretHex}`). */
export function nip46SecretKey(pubkey: string): string {
  return `nip46_${pubkey}`;
}

/** Keychain key for a user's NWC wallet config blob (`{wallets, defaultWalletId}`). */
export function nwcWalletsKey(pubkey: string): string {
  return `nwc_wallets_${pubkey}`;
}

/** Keychain key for a user's AI provider config blob (non-secret: baseUrl/label/model). */
export function llmProvidersKey(pubkey: string): string {
  return `llm_providers_${pubkey}`;
}

/** Keychain key for a single AI provider's API key (bearer credential). */
export function llmApiKeySecret(pubkey: string, providerId: string): string {
  return `llm_apikey_${pubkey}_${providerId}`;
}

/** Keychain key for the AI web-search provider API key. */
export function webSearchKeySecret(pubkey: string): string {
  return `ai_websearch_key_${pubkey}`;
}
