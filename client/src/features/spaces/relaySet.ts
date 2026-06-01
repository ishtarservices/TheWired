import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { Space } from "../../types/space";

/**
 * Relay-set overlay for a space (Decentralized Spaces, M9).
 *
 * NIP-29 permits a group to live on multiple relays (move/fork, same id), but
 * each relay is its own signing authority. Our model is **one signing authority
 * + N transport replicas (mirrors)**: `space.hostRelay` is the authority that
 * signs the group's 39000-2 (its `relayPubkey` is pinned), and additional
 * "mirror" relays hold a replica of the content (kind:9 + reactions + the
 * relay-signed metadata). The client reads from whichever relay answers (dedup
 * by event id, already in the pipeline) and publishes to ALL of them (outbox),
 * so the room survives the authority going offline.
 *
 * The set is published as a portable kind:30078 (NIP-78) `wired:relays:<groupId>`
 * overlay — same mechanism as the channel layout (M4). It is authoritative only
 * from the group's admins / creator / the relay's signing key.
 */

/** d-tag for a space's relay-set overlay. */
export function wiredRelaysDTag(groupId: string): string {
  return `wired:relays:${groupId}`;
}

/** A relay's role in the set. */
export type RelayRole = "authority" | "mirror";

export interface RelaySetEntry {
  url: string;
  role: RelayRole;
}

export interface ParsedRelaySet {
  authority?: string;
  mirrors: string[];
}

/** Normalize + validate a relay URL: ws/wss only, trimmed, no trailing slash. */
export function sanitizeRelayUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim().replace(/\/+$/, "");
  if (!/^wss?:\/\/[^\s]+$/i.test(url)) return null;
  if (url.length > 512) return null;
  return url;
}

/**
 * SECURITY: detect loopback / private / link-local / CGNAT / `.local` hosts —
 * addresses the client must NOT auto-dial from an *untrusted* relay-set overlay
 * (SSRF / LAN-probing / deanonymization guard). Mirrors the backend's
 * `relayUrlGuard`. NOTE: this is only applied to relays *learned from an
 * overlay* — the user's own chosen `hostRelay` (which may legitimately be a
 * loopback embedded relay) is never filtered.
 */
export function isPrivateOrLoopbackHost(hostOrUrl: string): boolean {
  let host = hostOrUrl.trim().replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
  if (host.startsWith("[")) {
    // [ipv6]:port
    const end = host.indexOf("]");
    host = host.slice(1, end > 0 ? end : undefined);
  } else if ((host.match(/:/g) || []).length === 1) {
    // host:port (a single colon) — a bare IPv6 has multiple colons, leave it.
    host = host.split(":")[0];
  }
  host = host.toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  // IPv6 (contains a colon): loopback, link-local (fe80::), unique-local (fc00::/7).
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 127) return true; // unspecified + loopback
    if (a === 10) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  }
  return false;
}

/**
 * Build our kind:30078 relay-set event for a space.
 * Tags: ["relay", url, "authority"|"mirror"].
 */
export function buildRelaySetEvent(
  pubkey: string,
  groupId: string,
  authorityUrl: string,
  mirrorUrls: string[],
): UnsignedEvent {
  const tags: string[][] = [
    ["d", wiredRelaysDTag(groupId)],
    ["alt", "Relay set for a The Wired space"],
  ];

  const seen = new Set<string>();
  const authority = sanitizeRelayUrl(authorityUrl);
  if (authority) {
    tags.push(["relay", authority, "authority"]);
    seen.add(authority);
  }
  for (const raw of mirrorUrls) {
    const url = sanitizeRelayUrl(raw);
    if (url && !seen.has(url)) {
      tags.push(["relay", url, "mirror"]);
      seen.add(url);
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags,
    content: "",
  };
}

/** Who may author a binding relay set for this space (authority + admins). */
function authorizedAuthors(space: Space): Set<string> {
  const set = new Set<string>(space.adminPubkeys);
  if (space.creatorPubkey) set.add(space.creatorPubkey);
  if (space.relayPubkey) set.add(space.relayPubkey);
  return set;
}

/**
 * Parse a kind:30078 relay-set event for `space`, or null if it isn't an
 * authorized relay set for it. Sanitizes URLs.
 */
export function parseRelaySetEvent(event: NostrEvent, space: Space): ParsedRelaySet | null {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (d !== wiredRelaysDTag(space.id)) return null;

  // SECURITY: the relay set is only trustworthy from the group's authority.
  if (!authorizedAuthors(space).has(event.pubkey)) return null;

  let authority: string | undefined;
  const mirrors: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "relay") continue;
    const url = sanitizeRelayUrl(tag[1]);
    // SECURITY: never auto-dial loopback/private addresses learned from an
    // overlay (SSRF / LAN-probing). The user's own hostRelay is applied
    // separately and is exempt.
    if (!url || seen.has(url) || isPrivateOrLoopbackHost(url)) continue;
    seen.add(url);
    if (tag[2] === "authority") {
      authority = url;
    } else {
      mirrors.push(url);
    }
  }

  if (!authority && mirrors.length === 0) return null;
  return { authority, mirrors };
}

/**
 * The effective set of relays for a space: the authority (`hostRelay`) plus any
 * mirrors, deduplicated. Used as the outbox/read set for the space's content.
 */
export function resolveRelaySet(space: Pick<Space, "hostRelay" | "relayUrls">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [space.hostRelay, ...(space.relayUrls ?? [])]) {
    const url = sanitizeRelayUrl(candidate) ?? candidate;
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
