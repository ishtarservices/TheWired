import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

/**
 * Parsed kind:0 profile content — the single hardened parser shared by
 * desktop (`Kind0Profile`) and mobile (`ProfileMetadata`); both names are
 * re-export aliases of this type.
 */
export interface ParsedProfile {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  /** Lightning address, `name@domain` form (NIP-57). Preferred over lud06. */
  lud16?: string;
  /** bech32-encoded LNURL-pay (`lnurl1…`), the older NIP-57 form. Some clients
   *  set this instead of lud16; we preserve and zap-resolve it. */
  lud06?: string;
  website?: string;
  /** created_at of the kind-0 this came from — newest wins (replaceable). */
  created_at: number;
}

/** Keys that, if preserved and later re-assigned via bracket notation or spread,
 *  could clobber an object's prototype. kind:0 content is attacker-controlled, and
 *  we preserve + republish unknown fields, so strip these at the boundary. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parse kind:0 event content into a profile; null for anything malformed. */
export function parseProfile(event: NostrEvent): ParsedProfile | null {
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

/** Build an unsigned kind:0 metadata event.
 *
 *  Read-modify-write: `profile` (the edited fields) is merged OVER `base` (the
 *  last-known kind:0 content), so fields the editing UI doesn't model — lud06,
 *  NIP-57 pointers, custom keys — survive a republish instead of being wiped.
 *  An edited field set to "" removes that key (an intentional clear).
 *
 *  Throws if the resulting content would be empty — publishing an empty kind:0
 *  permanently wipes the user's profile on all relays.
 *
 *  Generic over the input shapes so desktop's `Kind0Profile`, mobile's
 *  `ProfileMetadata`, and bare edit-form partials all type-check without an
 *  index signature — and the edited form and the stored base may differ. */
export function buildProfileEvent<P extends object, B extends object = P>(
  pubkey: string,
  profile: P,
  base?: B,
): UnsignedEvent {
  const merged = { ...(base ?? {}), ...profile } as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    // created_at is an event-level field, never profile content. The rest are
    // prototype-pollution keys: never assign them via bracket notation (it would
    // set `content`'s prototype) nor republish them out of preserved fields.
    if (
      key === "created_at" ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    )
      continue;
    if (value === undefined || value === null || value === "") continue;
    content[key] = value;
  }

  if (Object.keys(content).length === 0) {
    throw new Error(
      "Refusing to build kind:0 with empty profile — this would wipe the user's metadata on all relays",
    );
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
  };
}

/** Preferred display name: display_name → name → shortened pubkey. */
export function profileDisplayName(
  profile: Pick<ParsedProfile, "display_name" | "name"> | undefined,
  pubkey: string,
): string {
  const name = profile?.display_name?.trim() || profile?.name?.trim();
  if (name) return name;
  return `${pubkey.slice(0, 8)}…`;
}
