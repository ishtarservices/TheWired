// ─── Platform adapter interfaces ─────────────────────────────────────
// Phase 0 landed: the DI surface now lives in @thewired/core (adapters.ts).
// This file is the promised re-export so nothing downstream changes — the
// mobile implementations in src/platform/ keep importing from "@/core/adapters".

export type {
  WebSocketLike,
  WebSocketFactory,
  VerifierAdapter,
  StoreName,
  KVStore,
  StorageAdapter,
  EventSigner,
  SignerAdapter,
  SecretStoreAdapter,
  HttpInit,
  HttpResponse,
  HttpAdapter,
  PushRegistration,
  LocalNotification,
  PushAdapter,
  PlatformAdapters,
} from "@thewired/core";
