/**
 * Per-account storage for transport credentials — the NIP-46 bunker connection
 * and the NWC wallet URI. These are NOT the identity key.
 *
 * - Desktop (Tauri): OS keychain via the `keystore_*_secret` commands (non-biometric,
 *   so reconnect-on-launch and zap don't trigger Touch ID).
 * - Web: `localStorage` (plaintext — same posture as the desktop key file fallback).
 *
 * Keys embed the account pubkey, so storage is inherently account-scoped.
 */
import { TauriSigner } from "./tauriSigner";

const WEB_PREFIX = "thewired_secret_";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await TauriSigner.setSecret(key, value);
    return;
  }
  try {
    localStorage.setItem(WEB_PREFIX + key, value);
  } catch {
    /* storage unavailable */
  }
}

export async function getSecret(key: string): Promise<string | null> {
  if (isTauri()) {
    return TauriSigner.getSecret(key);
  }
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
  try {
    localStorage.removeItem(WEB_PREFIX + key);
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
