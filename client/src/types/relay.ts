/** Relay connection state */
export type RelayStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type RelayMode = "read" | "write" | "read+write";

/** Per-relay connection info */
export interface RelayInfo {
  url: string;
  status: RelayStatus;
  mode: RelayMode;
  latencyMs: number;
  eventCount: number;
  lastConnected?: number;
  error?: string;
}

/** NIP-65 relay list entry */
export interface RelayListEntry {
  url: string;
  mode: RelayMode;
}
