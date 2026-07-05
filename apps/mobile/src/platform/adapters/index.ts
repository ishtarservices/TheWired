// ─── Mobile adapter implementations ──────────────────────────────────
// Built once at startup (App.tsx) and threaded into createStore(). Real:
// WebSocket, SecureStore, SQLite storage, inline @noble verifier. Explicit
// not-implemented stubs where the wiring is later-phase work
// (mobile-guide/08-roadmap.md) — throwing loudly beats silently no-oping.

import * as SecureStore from "expo-secure-store";

import { createSqliteStorage } from "./sqliteStorage";
import { initAppPrefs } from "../appPrefs";
import type {
  HttpAdapter,
  PlatformAdapters,
  PushAdapter,
  SecretStoreAdapter,
  VerifierAdapter,
  WebSocketFactory,
  WebSocketLike,
} from "@/core/adapters";
import { verifyEventSync } from "@/lib/nostr/verifyEvent";

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

// Inline @noble verify — the desktop's main-thread fallback path, fine for
// v1 volumes (guide 06 §4). A worklet/native verifier is a later hot-path
// optimization behind this same interface.
const verifier: VerifierAdapter = {
  verify: async (event) => verifyEventSync(event),
};

// RN fetch. Redirect control (the SSRF-guard contract for untrusted URLs —
// LNURL/Blossom) is NOT implementable with RN's fetch; those call sites stay
// blocked until a native path exists rather than silently following
// redirects. First-party API calls (discovery) don't need it.
const http: HttpAdapter = {
  async fetch(url, init) {
    if (init?.maxRedirections !== undefined) {
      notImplemented("Http redirect control", "native module, later phase");
    }
    const controller = new AbortController();
    const timeout = init?.timeoutMs
      ? setTimeout(() => controller.abort(), init.timeoutMs)
      : null;
    try {
      const response = await fetch(url, {
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body as BodyInit | undefined,
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        headers,
        text: () => response.text(),
        json: () => response.json() as Promise<unknown>,
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  },
};

// TODO(Phase 3): APNs/FCM registration + Notifee local notifications.
const push: PushAdapter = {
  registerForPush: () => notImplemented("Push", "Phase 3"),
  presentLocal: () => notImplemented("Push", "Phase 3"),
};

export function createMobileAdapters(): PlatformAdapters {
  // expo-sqlite (Expo Go-compatible); op-sqlite is a dev-client-only
  // upgrade later — the swap is contained in sqliteStorage.ts.
  const storage = createSqliteStorage();
  initAppPrefs(storage);

  return {
    ws: wsFactory,
    verifier,
    storage,
    signer: null, // set after login (local nsec today; NIP-46 later)
    secretStore,
    http,
    push,
  };
}
