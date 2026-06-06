import type { NostrEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";

/** Keys that, if preserved and later re-assigned via bracket notation or spread,
 *  could clobber an object's prototype. kind:0 content is attacker-controlled, and
 *  we now preserve + republish unknown fields, so strip these at the boundary. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parse kind:0 event content into a profile */
export function parseProfile(event: NostrEvent): Kind0Profile | null {
  if (event.kind !== 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(event.content);
  } catch {
    return null;
  }
  // Must be a plain JSON object — reject primitives and arrays (an array would
  // otherwise spread into bogus numeric-keyed fields).
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;

  // Preserve any fields we don't model (custom keys, NIP-57 pointers, etc.) so a
  // read-modify-write republish never silently drops them — minus the dangerous
  // keys above. Building a fresh object key-by-key (vs `...obj`) keeps a literal
  // "__proto__" data property from being copied through.
  const preserved: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!DANGEROUS_KEYS.has(key)) preserved[key] = obj[key];
  }

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;

  return {
    ...preserved,
    name: str(obj.name),
    display_name: str(obj.display_name),
    about: str(obj.about),
    picture: str(obj.picture),
    banner: str(obj.banner),
    nip05: str(obj.nip05),
    lud16: str(obj.lud16),
    lud06: str(obj.lud06),
    website: str(obj.website),
    created_at: event.created_at,
  };
}
