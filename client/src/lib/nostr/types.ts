import type { NostrEvent, NostrFilter } from "../../types/nostr";
import type { RelayMode, RelayStatus } from "../../types/relay";

/** Callback for relay events */
export type RelayEventCallback = (event: NostrEvent, relayUrl: string) => void;

/** Callback for relay EOSE */
export type RelayEOSECallback = (subId: string, relayUrl: string) => void;

/** Callback for relay OK (publish acknowledgement) */
export type RelayOKCallback = (
  eventId: string,
  success: boolean,
  message: string,
  relayUrl: string,
) => void;

/** Callback for status changes */
export type RelayStatusCallback = (
  url: string,
  status: RelayStatus,
  error?: string,
) => void;

/** Subscription options */
export interface SubscribeOptions {
  filters: NostrFilter[];
  relayUrls?: string[];
  onEvent: RelayEventCallback;
  onEOSE?: RelayEOSECallback;
}

/** Relay connection config */
export interface RelayConfig {
  url: string;
  mode: RelayMode;
}
