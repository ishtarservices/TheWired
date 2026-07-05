/**
 * Hermes runtime polyfills — imported FIRST at the app entry (index.ts),
 * before anything that touches crypto or URLs (nostr-tools, @noble/*).
 * Order matters; see mobile-guide/05-dependencies.md §4.
 */

// crypto.getRandomValues — required by nostr-tools / @noble / nanoid.
import "react-native-get-random-values";

// URL / URLSearchParams — Hermes' built-ins are incomplete.
import "react-native-url-polyfill/auto";

// TextEncoder / TextDecoder — fast-text-encoding only installs itself where
// the globals are missing (recent Hermes has TextEncoder but TextDecoder
// coverage varies by version).
import "fast-text-encoding";

// Buffer: intentionally NOT polyfilled — nothing in the foundation needs it.
// If a future dep does (e.g. music-metadata), add the `buffer` package and
// assign globalThis.Buffer here.
