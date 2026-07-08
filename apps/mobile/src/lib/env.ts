// ─── Environment-aware endpoints ─────────────────────────────────────
// Mirrors the desktop client's contract (client/src/lib/api/client.ts +
// client/src/lib/nostr/constants.ts): dev builds target the local stack
// (gateway :9080, relay :7777), release builds target production, and an
// explicit env var always wins. Expo inlines EXPO_PUBLIC_* at bundle time
// (the mobile analog of Vite's VITE_*), and `__DEV__` is compiled false in
// release builds — so prod bundles can never accidentally point at a dev
// machine.
//
// The dev host comes from Metro's hostUri rather than a literal
// "localhost": on a physical device (LAN mode) localhost would be the
// phone itself; hostUri is the machine running Metro — which is the same
// machine running the dev stack.

/** "127.0.0.1:8081" / "192.168.1.5:8081" → the Metro machine's host. */
export function devHostFromHostUri(hostUri: string | undefined): string {
  const host = hostUri?.split(":")[0]?.trim();
  return host || "localhost";
}

/** True in Metro dev bundles; false in release. Node (jest, the headless QA
 *  peer script) has no __DEV__ — treat non-production NODE_ENV as dev. */
const IS_DEV: boolean =
  typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";

/** Metro's hostUri via expo-constants — absent under plain Node/jest. */
function metroHostUri(): string | undefined {
  try {
    // Lazy require so importing this module never drags expo-modules-core
    // into Node contexts (tsx scripts, jest) that can't load it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default as
      | { expoConfig?: { hostUri?: string } }
      | undefined;
    return Constants?.expoConfig?.hostUri;
  } catch {
    return undefined;
  }
}

export function resolveApiBase(options: {
  override: string | undefined;
  dev: boolean;
  devHost: string;
}): string {
  if (options.override) return options.override;
  return options.dev
    ? `http://${options.devHost}:9080/api`
    : "https://api.thewired.app/api";
}

export function resolveAppRelay(options: {
  override: string | undefined;
  dev: boolean;
  devHost: string;
}): string {
  if (options.override) return options.override;
  return options.dev ? `ws://${options.devHost}:7777` : "wss://relay.thewired.app";
}

const DEV_HOST = devHostFromHostUri(metroHostUri());

/** Backend API through the gateway (desktop: VITE_API_URL). */
export const API_BASE = resolveApiBase({
  override: process.env.EXPO_PUBLIC_API_URL,
  dev: IS_DEV,
  devHost: DEV_HOST,
});

/** The Wired's own relay — accepts all kinds (desktop: VITE_RELAY_URL). */
export const APP_RELAY = resolveAppRelay({
  override: process.env.EXPO_PUBLIC_RELAY_URL,
  dev: IS_DEV,
  devHost: DEV_HOST,
});

/**
 * Bootstrap read/write set (desktop BOOTSTRAP_RELAYS, trimmed to mobile's
 * 3-socket battery budget): the app relay + two public relays so the global
 * feed stays live in every environment.
 */
export const DEFAULT_RELAYS = [APP_RELAY, "wss://relay.damus.io", "wss://nos.lol"];
