/** Bootstrap relays used before user's relay list is loaded */
export const BOOTSTRAP_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://offchain.pub",
  "wss://nostr.wine",
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
