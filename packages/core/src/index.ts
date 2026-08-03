// @ishtarservices/core — the shared protocol/crypto layer consumed by the desktop
// client (Vite) and the mobile app (Metro). Pure TS: no DOM, no Tauri, no RN,
// no Web Crypto — platform capabilities arrive through the adapter interfaces.

export * from "./adapters";
export * from "./kinds";
export * from "./crypto/verifyEvent";
export * from "./crypto/nip44";
export * from "./crypto/giftWrap";
export * from "./crypto/nip17Room";
export * from "./nostr/dedup";
export * from "./nostr/profileParser";
export * from "./nostr/contactList";
export * from "./nostr/thread";
export * from "./nostr/profileSettings";
export * from "./nostr/profileShowcase";
