/**
 * NIP-11 relay information document probe.
 *
 * Used by the relay picker (Decentralized Spaces) to show capability badges
 * before a user commits a space to a relay. This is a standalone fetch — it does
 * NOT open a websocket or register the relay with `relayManager`, so probing a
 * relay never dials it for live traffic (AUTH-privacy: we only auto-connect
 * relays the user has actually opted into).
 */

export interface RelayInfo {
  /** The probed relay URL (ws/wss). */
  url: string;
  name?: string;
  description?: string;
  /** Relay master pubkey (NIP-11 `pubkey`) — used to authenticate 39000-2 events. */
  pubkey?: string;
  supportedNips: number[];
  software?: string;
  version?: string;
  /** NIP-29 group support (kind 9/9000-9022/39000-2). */
  supportsNip29: boolean;
  /** NIP-42 AUTH support — required before a relay can host a private space. */
  supportsNip42: boolean;
  /** NIP-50 full-text search. */
  supportsNip50: boolean;
  /** Relay advertises `limitation.auth_required`. */
  authRequired: boolean;
  /** Relay advertises a payment requirement. */
  paymentRequired: boolean;
}

import { createLogger } from "../debug/logger";

const log = createLogger("spaces");

/** Convert a ws(s):// relay URL to its NIP-11 http(s):// endpoint. */
function toHttpUrl(url: string): string {
  return url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
}

/**
 * Fetch + parse a relay's NIP-11 document. Returns null when the relay is
 * unreachable, times out, or doesn't serve a valid NIP-11 document.
 */
export async function probeRelayNip11(
  url: string,
  timeoutMs = 5000,
): Promise<RelayInfo | null> {
  try {
    const httpUrl = toHttpUrl(url);
    // Diagnostic: if a non-relay string (e.g. a bare group address) ever reaches
    // here, the fetched URL won't have an http(s) scheme — easy to spot.
    log.info(`probing NIP-11: ${httpUrl}`);
    const response = await fetch(httpUrl, {
      headers: { Accept: "application/nostr+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const info = await response.json();
    if (!info || typeof info !== "object") return null;

    const supportedNips: number[] = Array.isArray(info.supported_nips)
      ? info.supported_nips.filter((n: unknown): n is number => typeof n === "number")
      : [];

    return {
      url,
      name: typeof info.name === "string" ? info.name : undefined,
      description: typeof info.description === "string" ? info.description : undefined,
      pubkey: typeof info.pubkey === "string" ? info.pubkey : undefined,
      supportedNips,
      software: typeof info.software === "string" ? info.software : undefined,
      version: typeof info.version === "string" ? info.version : undefined,
      supportsNip29: supportedNips.includes(29),
      supportsNip42: supportedNips.includes(42),
      supportsNip50: supportedNips.includes(50),
      authRequired: info.limitation?.auth_required === true,
      paymentRequired: info.limitation?.payment_required === true,
    };
  } catch {
    // Unreachable / timeout / non-JSON — caller treats null as "unknown".
    return null;
  }
}
