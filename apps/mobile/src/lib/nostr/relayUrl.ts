// Peer-relay URL validation — the mobile mirror of the desktop's
// nip65.normalizeRelayUrl + security/ssrfGuard pairing, trimmed to what the
// DM send path needs: a kind-10050 published by the RECIPIENT is fully
// attacker-controlled (you dial whatever it lists), so only clean public
// wss:// endpoints are accepted. Unlike desktop there is no embedded-relay
// loopback exemption — mobile never dials localhost.

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|.*\.local|.*\.internal|.*\.lan)$/i;

/** Lowercase host, strip default port + trailing slash. Null when unparsable. */
export function normalizeRelayUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    url.hash = "";
    let out = url.toString();
    if (out.endsWith("/") && url.pathname === "/") out = out.slice(0, -1);
    return out;
  } catch {
    return null;
  }
}

/** True only for public wss:// relays — safe to dial from untrusted lists. */
export function isSafePeerRelayUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:") return false;
    if (!url.hostname || PRIVATE_HOST_RE.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Parse a kind-10050 event's relay tags into safe, normalized URLs. */
export function parseDMRelayTags(tags: string[][]): string[] {
  const urls: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== "relay" || !tag[1]) continue;
    const url = normalizeRelayUrl(tag[1]);
    if (url && isSafePeerRelayUrl(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
