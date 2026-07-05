# src/native

TypeScript bindings to native modules land here as they're built
(mobile-guide/04-native-modules.md):

- Keystore (iOS Keychain / Android Keystore signing) — Phase 4; NIP-46 covers
  v1 auth without it.
- SSRF-safe fetch with redirect control — backs the `HttpAdapter`.
- Push token plumbing (APNs/FCM) — Phase 3.

Nothing here yet — the foundation is pure JS/TS over Expo modules.
