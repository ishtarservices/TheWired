import { isIP } from "node:net";

/**
 * SSRF guard for relay URLs the backend will DIAL for ingestion (Decentralized
 * Spaces, M3). A registered relay URL is attacker-influenced (any space creator
 * can submit one), so before the multi-relay manager opens an outbound
 * WebSocket we reject loopback / private / link-local / cloud-metadata targets
 * and non-ws(s) schemes.
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

/** Is a literal IP address private, loopback, link-local, or otherwise unsafe to dial? */
function isUnsafeIp(rawHost: string): boolean {
  // URL.hostname keeps the brackets on IPv6 literals ("[::1]"); strip them so
  // net.isIP recognises the address.
  const host = rawHost.replace(/^\[|\]$/g, "");
  const fam = isIP(host);
  if (fam === 4) {
    const o = host.split(".").map((n) => parseInt(n, 10));
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (fam === 6) {
    const h = host.toLowerCase();
    if (h === "::1" || h === "::") return true; // loopback / unspecified
    if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
      return true; // link-local fe80::/10
    }
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4.
    const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isUnsafeIp(mapped[1]);
    return false;
  }
  return false; // not an IP literal
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

  const host = u.hostname.toLowerCase();
  if (!host) return { ok: false, reason: "missing host" };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "private/internal host not allowed" };
  }
  if (isUnsafeIp(host)) {
    return { ok: false, reason: "private/loopback/link-local address not allowed" };
  }

  const port = u.port ? `:${u.port}` : "";
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${host}${port}${path}` };
}
