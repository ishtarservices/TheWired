import type { Space } from "../../types/space";
import {
  isNip29Native,
  nativeInviteAddress,
  formatGroupAddress,
  relayUrlToHost,
  isEphemeralRelayHost,
} from "./spaceType";

/**
 * Decide what to show when inviting people to a relay-native space, reactive to
 * the live state of the user's self-hosted relay + tunnel.
 *
 * For a space hosted on the user's OWN relay (matched by `relayPubkey`, which is
 * stable across restarts unlike the tunnel URL), in reachability order:
 *  - relay off            → tell them to turn it on (`relay-off`)
 *  - tunnel live          → the CURRENT public tunnel address (`scope:"public"`)
 *  - LAN exposed          → the LAN address (`scope:"lan"`, same-network)
 *  - loopback only        → the loopback address (`scope:"local"`, this machine —
 *                           usable to test with a second app instance)
 * For any other (external) relay → the stored, stable address (`scope:"public"`).
 *
 * `scope` lets the UI explain how far the address reaches; `ephemeral` flags an
 * address that changes on restart (a throwaway `*.trycloudflare.com` tunnel).
 */

export type InviteScope = "public" | "lan" | "local";

export type NativeInvitePlan =
  | { kind: "address"; address: string; scope: InviteScope; ephemeral: boolean }
  | { kind: "relay-off" }
  | { kind: "no-address" };

interface RelayState {
  running: boolean;
  pubkey: string | null;
  /** `ws://127.0.0.1:<port>` — the loopback address (same machine). */
  ws_url?: string | null;
  /** `ws://<lan-ip>:<port>` — present when LAN access is enabled. */
  lan_url?: string | null;
}
interface TunnelState {
  running: boolean;
  url: string | null;
}

/** Convert a tunnel's `https://…` URL to its bare ws host. */
function tunnelHost(httpsUrl: string): string {
  return relayUrlToHost(
    httpsUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://"),
  );
}

export function nativeInvitePlan(
  space: Pick<Space, "spaceType" | "groupRef" | "relayPubkey">,
  relay: RelayState | null,
  tunnel: TunnelState | null,
): NativeInvitePlan {
  if (!isNip29Native(space) || !space.groupRef) return { kind: "no-address" };
  const { groupId, host } = space.groupRef;

  const isMyRelay = !!space.relayPubkey && !!relay?.pubkey && relay.pubkey === space.relayPubkey;
  if (isMyRelay) {
    if (!relay!.running) return { kind: "relay-off" };
    if (tunnel?.running && tunnel.url) {
      const tHost = tunnelHost(tunnel.url);
      return {
        kind: "address",
        address: formatGroupAddress({ host: tHost, groupId }),
        scope: "public",
        // a throwaway *.trycloudflare.com tunnel changes on restart; a branded one is stable
        ephemeral: isEphemeralRelayHost(tHost),
      };
    }
    if (relay!.lan_url) {
      return {
        kind: "address",
        address: formatGroupAddress({ host: relayUrlToHost(relay!.lan_url), groupId }),
        scope: "lan",
        ephemeral: false,
      };
    }
    if (relay!.ws_url) {
      return {
        kind: "address",
        address: formatGroupAddress({ host: relayUrlToHost(relay!.ws_url), groupId }),
        scope: "local",
        ephemeral: false,
      };
    }
    return { kind: "no-address" };
  }

  // Not the user's relay (external host, or status unknown) → stable stored address.
  const stored = nativeInviteAddress(space) ?? formatGroupAddress(space.groupRef);
  return { kind: "address", address: stored, scope: "public", ephemeral: isEphemeralRelayHost(host) };
}
