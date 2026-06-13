/** Normalize relay URL. Leaf module (no imports) so relayManager can use it
 *  without creating a cycle through nip65.ts. */
export function normalizeRelayUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return null;
    // Ensure trailing slash is removed for consistency
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
