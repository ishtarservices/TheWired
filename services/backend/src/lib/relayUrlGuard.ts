import { isIP } from "node:net";

/**
 * SSRF guard for relay URLs the backend will DIAL for ingestion (Decentralized
 * Spaces, M3). A registered relay URL is attacker-influenced (any space creator
 * can submit one), so before the multi-relay manager opens an outbound
 * WebSocket we reject loopback / private / link-local / cloud-metadata targets
 * and non-ws(s) schemes. The same host rules gate a space's `hostRelay`
 * (`checkHostRelayUrl`), which every member's client dials.
 *
 * Note: this checks the URL's literal host. A DNS name that *resolves* to a
 * private IP is a residual (DNS-rebinding) vector — the manager should re-check
 * the resolved address at connect time. This guard blocks the obvious cases at
 * registration.
 */

export interface RelayUrlCheck {
  ok: boolean;
  /** Normalised URL (lowercased host, no trailing slash) when ok. */
  url?: string;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/** Suffixes that only ever resolve inside a private network. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

function isUnsafeIpv4(host: string): boolean {
  const o = host.split(".").map((n) => parseInt(n, 10));
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = o;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** An IPv6 literal as 16 bytes (handles `::` and a dotted IPv4 tail), or null. */
function ipv6Bytes(host: string): number[] | null {
  let h = host.toLowerCase();
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const v4 = h.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[2].split(".").map((n) => parseInt(n, 10));
    if (o.some((n) => Number.isNaN(n) || n > 255)) return null;
    h = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isUnsafeIpv6(host: string): boolean {
  const b = ipv6Bytes(host);
  if (!b) return true; // unparseable literal: refuse rather than guess
  const zeros = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  const v4At = (i: number) => b.slice(i, i + 4).join(".");
  if (zeros(0, 15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
  if (zeros(0, 10) && b[10] === 0xff && b[11] === 0xff) return isUnsafeIpv4(v4At(12)); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return isUnsafeIpv4(v4At(12)); // ::a.b.c.d (deprecated "compatible")
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) {
    return isUnsafeIpv4(v4At(12)); // NAT64 64:ff9b::/96
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isUnsafeIpv4(v4At(2)); // 6to4 2002::/16
  if ((b[0] & 0xfe) === 0xfc) return true; // ULA fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // site-local fec0::/10
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation
  if (b[0] === 0x01 && zeros(1, 8)) return true; // discard 100::/64
  return false;
}

/** Is a literal IP address private, loopback, link-local, or otherwise unsafe to dial? */
function isUnsafeIp(rawHost: string): boolean {
  // URL.hostname keeps the brackets on IPv6 literals ("[::1]"); strip them so
  // net.isIP recognises the address. WHATWG URL parsing has already turned
  // decimal / hex IPv4 forms ("2130706433", "0x7f.1") into dotted quads, and
  // rewritten "::ffff:127.0.0.1" as "::ffff:7f00:1" — ipv6Bytes decodes both.
  const host = rawHost.replace(/^\[|\]$/g, "");
  const fam = isIP(host);
  if (fam === 4) return isUnsafeIpv4(host);
  if (fam === 6) return isUnsafeIpv6(host);
  return false; // not an IP literal
}

/** Is this URL host a private name or address? */
export function isPrivateHost(rawHost: string): boolean {
  // A trailing dot ("localhost.") resolves exactly like the name without it.
  const host = rawHost.toLowerCase().replace(/\.+$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host) || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isUnsafeIp(host)) return true;
  // A single-label name ("relay") only resolves through a local search domain.
  if (!host.startsWith("[") && isIP(host) === 0 && !host.includes(".")) return true;
  return false;
}

/**
 * Validate + normalise a relay URL for ingestion registration.
 * @param raw           the submitted URL
 * @param allowInsecure when true (dev), permit `ws://`; production requires `wss://`
 */
export function checkRelayUrl(raw: string, allowInsecure: boolean): RelayUrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (u.protocol !== "wss:" && u.protocol !== "ws:") {
    return { ok: false, reason: "relay URL must be ws:// or wss://" };
  }
  if (u.protocol === "ws:" && !allowInsecure) {
    return { ok: false, reason: "relay URL must use wss://" };
  }

  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return { ok: false, reason: "missing host" };
  if (isPrivateHost(host)) {
    return { ok: false, reason: "private/loopback/link-local host not allowed" };
  }

  const port = u.port ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${host}${port}${path}` };
}

/**
 * A space's `hostRelay` (routes/spaces.ts). Clients dial it, so it must be
 * `wss://` on a PUBLIC host — never a private, loopback, link-local, CGNAT or
 * IPv6 ULA address, which would point every member's client at their own LAN
 * or at services on their own machine. The platform's own relay URLs are always
 * accepted (in dev that is ws://localhost:7777). The submitted string is kept
 * as-is when ok, since clients compare it to their configured relay URLs.
 */
export function checkHostRelayUrl(raw: string, ownRelayUrls: string[]): RelayUrlCheck {
  const trimmed = raw.trim();
  const norm = (v: string) => v.trim().toLowerCase().replace(/\/+$/, "");
  if (ownRelayUrls.some((own) => own && norm(own) === norm(trimmed))) {
    return { ok: true, url: trimmed };
  }
  const check = checkRelayUrl(trimmed, false);
  return check.ok ? { ok: true, url: trimmed } : check;
}
