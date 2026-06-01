// Typed bindings for the embedded self-hosted relay + public tunnel
// (Decentralized Spaces M6/M7). These wrap Tauri IPC commands defined in
// `client/src-tauri/src/relay.rs` and `tunnel.rs`. They are only available in
// the desktop (Tauri) build — guard calls with `embeddedRelaySupported()`.

import { invoke } from "@tauri-apps/api/core";
import { api } from "@/lib/api/client";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Whether hosting a relay is possible in this build (desktop only). */
export const embeddedRelaySupported = (): boolean => isTauri;

/** Field names match the Rust `RelayStatus` (serde, snake_case). */
export interface EmbeddedRelayStatus {
  running: boolean;
  ws_url: string | null;
  /** `ws://<lan-ip>:<port>` when the relay is exposed on the local network. */
  lan_url: string | null;
  /** The relay's NIP-29 signing pubkey — clients pin this as the 39xxx author. */
  pubkey: string | null;
  port: number | null;
}

export interface EmbeddedRelayStats {
  status: EmbeddedRelayStatus;
  data_dir: string;
  db_size_bytes: number;
  event_count: number;
  group_count: number;
}

export interface TunnelStatus {
  running: boolean;
  url: string | null;
}

/**
 * Start the relay. `ownerPubkey` (the logged-in user) becomes the only identity
 * allowed to create groups — important when the relay is publicly tunneled, so
 * strangers can't turn it into an open relay.
 */
export const startEmbeddedRelay = (
  ownerPubkey?: string,
  lan = false,
): Promise<EmbeddedRelayStatus> =>
  invoke<EmbeddedRelayStatus>("relay_start", { ownerPubkey, lan });

export const stopEmbeddedRelay = (): Promise<EmbeddedRelayStatus> =>
  invoke<EmbeddedRelayStatus>("relay_stop");

export const getEmbeddedRelayStatus = (): Promise<EmbeddedRelayStatus> =>
  invoke<EmbeddedRelayStatus>("relay_status");

export const getEmbeddedRelayStats = (): Promise<EmbeddedRelayStats> =>
  invoke<EmbeddedRelayStats>("relay_stats");

/**
 * Delete the relay's stored data. When `wipeIdentity` is true the signing key
 * is also removed — the relay gets a NEW pubkey next start, so hosted groups
 * change authority and members must re-trust it.
 */
export const resetEmbeddedRelay = (
  wipeIdentity = false,
): Promise<EmbeddedRelayStatus> =>
  invoke<EmbeddedRelayStatus>("relay_reset", { wipeIdentity });

/** How the relay is exposed publicly:
 *  - `"named"` — the default `<id>.relay.thewired.app` (stable; needs the
 *    platform's Cloudflare setup),
 *  - `"quick"` — a throwaway `*.trycloudflare.com` URL (zero-config, ephemeral),
 *  - `"custom"` — a user-supplied public `wss://` URL (their own tunnel/proxy;
 *    no cloudflared process — we just record the address). */
export type TunnelMode = "quick" | "named" | "custom";

/** Record a user's own public relay URL (their external tunnel/reverse proxy). */
export const setCustomTunnel = (url: string): Promise<TunnelStatus> =>
  invoke<TunnelStatus>("tunnel_set_custom", { url });

/** Backend response from `/relays/tunnel/provision` (camelCase). */
interface NamedTunnelConfig {
  tunnelId: string;
  hostname: string;
  accountTag: string;
}

/**
 * Provision (or reuse) this user's branded relay tunnel. The connector secret is
 * generated + held on-device (keychain, via `tunnel_named_identity`); we forward
 * it to the NIP-98-authed backend so Cloudflare creates the tunnel with the same
 * secret, then return the tunnel ids for the local connector.
 */
async function provisionNamedTunnel(tunnelSecret: string, reset = false): Promise<NamedTunnelConfig> {
  const { data } = await api<NamedTunnelConfig>("/relays/tunnel/provision", {
    method: "POST",
    body: { tunnelSecret, reset },
  });
  return data;
}

export const startTunnel = async (
  mode: TunnelMode = "named",
  customUrl?: string,
): Promise<TunnelStatus> => {
  if (mode === "custom") {
    if (!customUrl) throw new Error("A custom relay URL is required");
    return setCustomTunnel(customUrl);
  }
  if (mode === "named") {
    const { tunnel_secret } = await invoke<{ tunnel_secret: string }>("tunnel_named_identity");
    const named = await provisionNamedTunnel(tunnel_secret);
    // Nested struct fields are snake_case (serde-deserialized in tunnel.rs);
    // Tauri's camel→snake mapping only applies to top-level command args.
    return invoke<TunnelStatus>("tunnel_start", {
      mode,
      named: { tunnel_id: named.tunnelId, hostname: named.hostname, account_tag: named.accountTag },
    });
  }
  return invoke<TunnelStatus>("tunnel_start", { mode });
};

export const stopTunnel = (): Promise<TunnelStatus> =>
  invoke<TunnelStatus>("tunnel_stop");

export const getTunnelStatus = (): Promise<TunnelStatus> =>
  invoke<TunnelStatus>("tunnel_status");

/** Convert a tunnel's `https://…` URL to the `wss://…` relay URL. */
export const tunnelToRelayUrl = (httpsUrl: string): string =>
  httpsUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");

/** Human-readable byte size. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};
