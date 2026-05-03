/** The Wired's own relay — guaranteed to accept all event kinds including gift wraps */
export const APP_RELAY = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:7777";

/** General-purpose writable relays used before the user's relay list is loaded.
 *  Safe for PUBLISH of any kind (gift wraps, kind:10002, etc) and for SUBSCRIBE.
 *  Dropped nostr.wine (paywalled, rejected writes with "restricted: sign up") and
 *  offchain.pub (20-sub cap with low payoff). */
export const BOOTSTRAP_RELAYS = [
  APP_RELAY,
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
];

/** READ-ONLY profile/relay-list indexer relays. They specialize in kind:0/3/10002 and
 *  reject most other kinds, so NEVER publish arbitrary events to them. Use them for
 *  fetching any pubkey's profile or NIP-65 relay list reliably. */
export const INDEXER_RELAYS = [
  "wss://purplepag.es",
  "wss://user.kindpag.es",
];

/** Targeted relays for profile data lookups (kind:0, kind:1, kind:3, kind:6, kind:30023).
 *  Combines the indexer specialists with damus.io (300-sub cap absorbs traffic that
 *  20-cap relays like primal/nos.lol would defer). */
export const PROFILE_RELAYS = [
  APP_RELAY,
  ...INDEXER_RELAYS,
  "wss://relay.damus.io",
];

/** Reconnection backoff parameters */
export const RECONNECT = {
  /** Initial delay in ms */
  BASE_DELAY: 1000,
  /** Maximum delay cap in ms */
  MAX_DELAY: 60_000,
  /** Jitter factor (+/- this percentage) */
  JITTER: 0.25,
  /** Number of disconnects within STORM_WINDOW to trigger storm detection */
  STORM_THRESHOLD: 3,
  /** Time window for storm detection in ms */
  STORM_WINDOW: 5_000,
  /** Cooldown when storm detected in ms */
  STORM_COOLDOWN: 10_000,
} as const;

/** Subscription limits */
export const SUBSCRIPTION = {
  /** Maximum subscription ID length per NIP-01 */
  MAX_SUB_ID_LENGTH: 64,
} as const;
