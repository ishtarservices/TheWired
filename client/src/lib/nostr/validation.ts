import type { NostrEvent } from "../../types/nostr";

/** Validate structural integrity of a Nostr event (fast, no crypto) */
export function isValidEventStructure(event: unknown): event is NostrEvent {
  if (!event || typeof event !== "object") return false;

  const e = event as Record<string, unknown>;

  if (typeof e.id !== "string" || e.id.length !== 64) return false;
  if (typeof e.pubkey !== "string" || e.pubkey.length !== 64) return false;
  if (typeof e.created_at !== "number" || !Number.isInteger(e.created_at))
    return false;
  if (typeof e.kind !== "number" || !Number.isInteger(e.kind) || e.kind < 0)
    return false;
  if (!Array.isArray(e.tags)) return false;
  if (typeof e.content !== "string") return false;
  if (typeof e.sig !== "string" || e.sig.length !== 128) return false;

  // Validate tags are arrays of strings
  for (const tag of e.tags) {
    if (!Array.isArray(tag)) return false;
    for (const item of tag) {
      if (typeof item !== "string") return false;
    }
  }

  // Reject events too far in the future (>15 min)
  const now = Math.floor(Date.now() / 1000);
  if (e.created_at > now + 900) return false;

  return true;
}

/** Check if event is hex-encoded */
export function isHex(s: string): boolean {
  return /^[0-9a-f]+$/i.test(s);
}
