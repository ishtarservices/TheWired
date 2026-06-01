import type { GroupRef, Space, SpaceType } from "../../types/space";
import { isPrivateOrLoopbackHost } from "./relaySet";

/**
 * Helpers for the three space modes (see {@link SpaceType}). All mode branching
 * in the app should route through `isBackendBacked` / `isNip29Native` so the
 * "platform stays 100% intact" guarantee lives in exactly one place.
 */

/** Resolve a space's mode, defaulting legacy/cached spaces to "platform". */
export function getSpaceType(space: Pick<Space, "spaceType">): SpaceType {
  return space.spaceType ?? "platform";
}

/**
 * True when the backend owns this space's metadata/channels/roles/membership
 * (platform + decentralized-A-lite). This is the single predicate that gates
 * every backend API call for a space.
 */
export function isBackendBacked(space: Pick<Space, "spaceType">): boolean {
  const t = getSpaceType(space);
  return t === "platform" || t === "decentralized-alite";
}

/** True when the space is a relay-authoritative NIP-29 group (no backend). */
export function isNip29Native(space: Pick<Space, "spaceType">): boolean {
  return getSpaceType(space) === "nip29-native";
}

/** True when the host relay is creator-chosen rather than the platform relay. */
export function isDecentralized(space: Pick<Space, "spaceType">): boolean {
  return getSpaceType(space) !== "platform";
}

/**
 * Parse a NIP-29 group address `<host>'<groupId>` (e.g.
 * `groups.0xchat.com'abcd1234`). The host is the bare relay host with no
 * scheme. Returns null if the input isn't a well-formed group address.
 */
export function parseGroupAddress(input: string): GroupRef | null {
  const raw = input.trim();
  // NIP-29 uses a single apostrophe as the host/group separator.
  const sep = raw.indexOf("'");
  if (sep <= 0 || sep === raw.length - 1) return null;
  const host = stripScheme(raw.slice(0, sep)).replace(/\/+$/, "");
  const groupId = raw.slice(sep + 1).trim();
  if (!host || !groupId || host.includes("'") || groupId.includes("'")) return null;
  return { host, groupId };
}

/** Format a {@link GroupRef} back into its `<host>'<groupId>` string form. */
export function formatGroupAddress(ref: GroupRef): string {
  return `${stripScheme(ref.host).replace(/\/+$/, "")}'${ref.groupId}`;
}

/** Build a websocket URL from a bare relay host (defaults to wss). */
export function hostToRelayUrl(host: string): string {
  const h = host.trim();
  if (h.startsWith("ws://") || h.startsWith("wss://")) return h;
  const bare = stripScheme(h);
  // Loopback / LAN / link-local hosts (self-hosted + embedded relays, incl.
  // LAN-bind like 10.x / 192.168.x / 100.64.x) have no public TLS cert, so they
  // speak plain `ws`. Only genuinely public hosts get `wss`. Using `wss` for a
  // LAN IP fails the TLS handshake → "network connection lost".
  return `${isPrivateOrLoopbackHost(bare) ? "ws" : "wss"}://${bare}`;
}

/** Strip a leading ws/wss/http/https scheme from a host string. */
function stripScheme(value: string): string {
  return value.replace(/^(wss?|https?):\/\//, "");
}

/** Derive the bare relay host from a relay websocket/http URL. */
export function relayUrlToHost(url: string): string {
  return stripScheme(url.trim()).replace(/\/+$/, "");
}

/**
 * True for throwaway tunnel hosts whose public URL changes on every restart
 * (Cloudflare quick tunnels). A space or invite pinned to one is temporary —
 * it breaks once the tunnel is recycled. Branded/named tunnels and normal
 * relays are stable and return false.
 */
export function isEphemeralRelayHost(hostOrUrl: string): boolean {
  const h = stripScheme(hostOrUrl.trim()).replace(/\/+$/, "").toLowerCase();
  return h.endsWith(".trycloudflare.com");
}

/**
 * The share target for inviting people to a space:
 *  - For a relay-native (nip29-native) space, returns its group address
 *    `<host>'<groupId>` — recipients paste it into "Import a Group". `null` if
 *    the space somehow has no `groupRef`.
 *  - For backend-backed spaces (platform / A-lite), returns `null` → the caller
 *    must use the backend invite-code flow instead.
 *
 * Gating an invite UI on this is REQUIRED: the backend invite endpoint rejects
 * native spaces with "Not a member" since they have no backend registration.
 */
export function nativeInviteAddress(
  space: Pick<Space, "spaceType" | "groupRef">,
): string | null {
  if (!isNip29Native(space)) return null;
  return space.groupRef ? formatGroupAddress(space.groupRef) : null;
}

/**
 * Local identity key for a space. Native/decentralized spaces are keyed by
 * `<host>'<groupId>` so the same group imported from two relays — or a native
 * group whose random id collides with a platform space — never overwrite each
 * other. Platform spaces keep their bare id.
 */
export function spaceLocalKey(space: Pick<Space, "id" | "spaceType" | "groupRef">): string {
  if (isNip29Native(space) && space.groupRef) {
    return formatGroupAddress(space.groupRef);
  }
  return space.id;
}
