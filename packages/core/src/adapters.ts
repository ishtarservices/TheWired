// ─── Platform adapter interfaces ─────────────────────────────────────
// The dependency-injection surface between @thewired/core and each app
// (mobile-guide/01-architecture.md §3). TYPES ONLY — the concrete
// implementations live in each app (client/src for desktop, apps/mobile
// /src/platform for mobile). Keep this file dependency-free apart from
// @thewired/shared-types.

import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

// ─── WebSocket ───────────────────────────────────────────────────────

/** The subset of the WebSocket API relayConnection.ts actually uses. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** Creates a platform WebSocket. Desktop: global WebSocket. RN: global WebSocket (API-compatible). */
export interface WebSocketFactory {
  create(url: string): WebSocketLike;
}

// ─── Verification ────────────────────────────────────────────────────

/**
 * Verifies event id + schnorr signature. Desktop: Web Worker bridge.
 * RN: JSI worklet / native secp256k1 / inline @noble (the pipeline already
 * tolerates a synchronous main-thread fallback). Implementations may batch.
 */
export interface VerifierAdapter {
  verify(event: NostrEvent): Promise<boolean>;
}

// ─── Storage ─────────────────────────────────────────────────────────

/**
 * The logical stores of the desktop IndexedDB schema (+ audio blob cache).
 * Maps 1:1 to IDB object stores on desktop and SQLite tables on mobile.
 * dm_messages/dm_state carry decrypted NIP-17 rumors + conversation state —
 * local-only by design (rumors are never re-published).
 */
export type StoreName =
  | "events"
  | "profiles"
  | "outbox"
  | "user_state"
  | "aiConversations"
  | "aiMessages"
  | "aiPendingWrites"
  | "articleDrafts"
  | "dm_messages"
  | "dm_state";

/** Minimal KV surface the lib/db store wrappers need (get/put/delete/iterate). */
export interface KVStore<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  getAll(): Promise<T[]>;
  getAllKeys(): Promise<string[]>;
  clear(): Promise<void>;
}

/** Local persistence. Desktop: IndexedDB (idb). RN: SQLite (expo-sqlite). */
export interface StorageAdapter {
  getStore<T>(name: StoreName): KVStore<T>;
  /** Per-account isolation — desktop opens `thewired_<pubkey>` databases. */
  openForAccount(pubkey: string): Promise<void>;
  close(): Promise<void>;
}

// ─── Signing ─────────────────────────────────────────────────────────

/**
 * The base signer contract: identity + event signing. This is the shape of
 * the desktop `NostrSigner` (client/src/lib/nostr/signer.ts keeps that name
 * as an alias of this interface).
 */
export interface EventSigner {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedEvent): Promise<NostrEvent>;
}

/**
 * Full signer with NIP-44 — what the DM crypto stack (giftWrap/nip17Room)
 * needs. Desktop: Tauri keystore / NIP-07 / NIP-46 behind the nip44.ts
 * dispatch shim. Mobile: LocalNsecSigner (nostr-tools nip44.v2), NIP-46
 * later. All implementations must be driven through the signing queue.
 */
export interface SignerAdapter extends EventSigner {
  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string>;
  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string>;
}

// ─── Secrets ─────────────────────────────────────────────────────────

/**
 * Non-key transport secrets (NIP-46 bunker URI, NWC URI, LLM/API keys).
 * Desktop: OS keychain via Tauri. Mobile: expo-secure-store.
 */
export interface SecretStoreAdapter {
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
}

// ─── HTTP ────────────────────────────────────────────────────────────

export interface HttpInit {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Redirect budget — 0 blocks redirects entirely (SSRF guard contract). */
  maxRedirections?: number;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  bytes(): Promise<Uint8Array>;
}

/**
 * SSRF-safe HTTP with redirect control (LNURL, Blossom, AI providers).
 * Desktop: Tauri plugin-http. Mobile: fetch + native module where redirect
 * control is required.
 */
export interface HttpAdapter {
  fetch(url: string, init?: HttpInit): Promise<HttpResponse>;
}

// ─── Push ────────────────────────────────────────────────────────────

export interface PushRegistration {
  token: string;
  platform: "apns" | "fcm" | "webpush";
}

export interface LocalNotification {
  title: string;
  body: string;
  /** Deep link to open when tapped (nostr: / thewired: / https URL). */
  url?: string;
  threadId?: string;
}

/** Native push registration + local notifications. Desktop: web-push or no-op. */
export interface PushAdapter {
  registerForPush(): Promise<PushRegistration>;
  presentLocal(notification: LocalNotification): Promise<void>;
}

// ─── Aggregate ───────────────────────────────────────────────────────

/** Everything a platform must provide — built once at startup and threaded
 *  into createStore() and the core singleton constructors. */
export interface PlatformAdapters {
  ws: WebSocketFactory;
  verifier: VerifierAdapter;
  storage: StorageAdapter;
  signer: SignerAdapter | null; // null until the user logs in
  secretStore: SecretStoreAdapter;
  http: HttpAdapter;
  push: PushAdapter;
}
