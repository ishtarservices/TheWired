// ─── Mobile adapter implementations ──────────────────────────────────
// Built once at startup (App.tsx) and threaded into createStore(). Real where
// the platform already provides the capability (WebSocket, SecureStore);
// explicit not-implemented stubs where the wiring is Phase 0/1 work
// (mobile-guide/08-roadmap.md) — throwing loudly beats silently no-oping.

import * as SecureStore from "expo-secure-store";

import type {
  HttpAdapter,
  PlatformAdapters,
  PushAdapter,
  SecretStoreAdapter,
  StorageAdapter,
  VerifierAdapter,
  WebSocketFactory,
  WebSocketLike,
} from "@/core/adapters";

/** RN ships a global WebSocket that is API-compatible with the browser's. */
const wsFactory: WebSocketFactory = {
  create(url: string): WebSocketLike {
    return new WebSocket(url) as unknown as WebSocketLike;
  },
};

/** expo-secure-store — iOS Keychain / Android Keystore-encrypted prefs. */
const secretStore: SecretStoreAdapter = {
  async getSecret(key) {
    return (await SecureStore.getItemAsync(toStoreKey(key))) ?? null;
  },
  async setSecret(key, value) {
    await SecureStore.setItemAsync(toStoreKey(key), value);
  },
  async deleteSecret(key) {
    await SecureStore.deleteItemAsync(toStoreKey(key));
  },
};

/** SecureStore keys only allow [A-Za-z0-9._-]; desktop secret ids may not. */
function toStoreKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

function notImplemented(what: string, phase: string): never {
  throw new Error(`${what} adapter not implemented yet (${phase} — see mobile-guide/08-roadmap.md)`);
}

// TODO(Phase 1): inline @noble verify first (verifyEventSync port), then a
// worklet/native implementation for the hot path.
const verifier: VerifierAdapter = {
  verify: () => notImplemented("Verifier", "Phase 1"),
};

// TODO(Phase 1): op-sqlite-backed KV stores mirroring the IDB schema.
const storage: StorageAdapter = {
  getStore: () => notImplemented("Storage", "Phase 1"),
  openForAccount: () => notImplemented("Storage", "Phase 1"),
  close: async () => {},
};

// TODO(Phase 1): fetch-based impl + redirect-controlled native fetch for the
// SSRF-guarded call sites (LNURL/Blossom).
const http: HttpAdapter = {
  fetch: () => notImplemented("Http", "Phase 1"),
};

// TODO(Phase 3): APNs/FCM registration + Notifee local notifications.
const push: PushAdapter = {
  registerForPush: () => notImplemented("Push", "Phase 3"),
  presentLocal: () => notImplemented("Push", "Phase 3"),
};

export function createMobileAdapters(): PlatformAdapters {
  return {
    ws: wsFactory,
    verifier,
    storage,
    signer: null, // set after login (NIP-46 first — guide 00 decisions)
    secretStore,
    http,
    push,
  };
}
