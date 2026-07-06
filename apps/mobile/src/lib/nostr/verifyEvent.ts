// Moved to @thewired/core (Phase 0) — single-sourced with the desktop's main
// thread fallback path. On mobile this IS the verifier for v1 volumes (a
// worklet/native implementation is a later optimization); it backs the
// VerifierAdapter in platform/adapters.
export { verifyEventSync, type VerifiableEvent } from "@thewired/core";
