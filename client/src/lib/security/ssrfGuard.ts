/**
 * SSRF guard for URLs / relay addresses derived from UNTRUSTED Nostr data —
 * kind:0 profile fields (lud16 / lud06 / picture …), relay hints in events,
 * LNURL `callback` strings, etc.
 *
 * Mirrors the backend guard (`services/backend/src/lib/relayUrlGuard.ts`,
 * `isUnsafeIp`) but is pure-JS (no `node:net`) so it runs in the Tauri webview /
 * browser. Keep the two in sync — or unify into `packages/shared-types` later.
 *
 * IMPORTANT — apply this at the *untrusted-data boundary* (the LNURL resolver,
 * the kind:10050 relay-list parser), NOT as a blanket block on the shared
 * transport: the client legitimately talks to loopback (the embedded relay on
 * :7787, local LLM engines on :11434), and those code paths must stay working.
 *
 * Residual: a literal-host check cannot stop a *hostname* that resolves to a
 * private IP (DNS rebinding); the Tauri HTTP plugin doesn't expose resolved-IP
 * pinning. This blocks the obvious cases — literal internal IPs (incl. integer /
 * hex / octal encodings, which the WHATWG URL parser normalises to dotted form),
 * `localhost`, and redirect-to-internal — matching the backend guard's stance.
 */

export class SsrfBlockedError extends Error {
  constructor(public readonly reason: string) {
    super("Blocked a request to a private or local network address.");
    this.name = "SsrfBlockedError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/** Is a literal IP host loopback / private / link-local / CGNAT / multicast / etc.? */
export function isUnsafeIp(rawHost: string): boolean {
  // URL.hostname keeps brackets on IPv6 literals ("[::1]"); strip them.
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const o = v4.slice(1, 5).map((n) => parseInt(n, 10));
    if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
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

  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true; // loopback / unspecified
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // ULA fc00::/7
    if (
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    ) {
      return true; // link-local fe80::/10
    }
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host); // IPv4-mapped
    if (mapped) return isUnsafeIp(mapped[1]);
    return false;
  }

  return false; // not an IP literal
}

/** Is a host (any scheme) unsafe to reach with untrusted input? */
export function isUnsafeHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return isUnsafeIp(host);
}

/**
 * Validate an http(s) URL built from untrusted data before fetching it. Requires
 * `https:` (plain `http:` allowed only for real `.onion` / Tor, which has no TLS).
 * Throws {@link SsrfBlockedError} on a malformed URL, a disallowed scheme, or an
 * internal / private host. On success returns the (trimmed) URL UNCHANGED, so the
 * caller's exact query string is preserved (LNURL appends a pre-encoded `nostr=`).
 */
export function assertSafeFetchUrl(raw: string): string {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new SsrfBlockedError("malformed URL");
  }
  const host = u.hostname.toLowerCase();
  const isOnion = host.endsWith(".onion");
  if (u.protocol === "https:") {
    // ok
  } else if (u.protocol === "http:" && isOnion) {
    // ok — Tor hidden services have no TLS
  } else {
    throw new SsrfBlockedError(`scheme '${u.protocol}' not allowed`);
  }
  if (isUnsafeHost(host)) {
    throw new SsrfBlockedError(`host '${host}' is private/loopback`);
  }
  return trimmed;
}

/** Is a ws(s) relay URL from untrusted data safe to dial? (non-throwing) */
export function isSafeRelayUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return false;
  return !isUnsafeHost(u.hostname.toLowerCase());
}
