// kind-0 profile parsing — ports the desktop profileParser's hardening
// (client/src/features/profile/profileParser.ts): content is attacker-
// controlled JSON, so reject non-objects and strip prototype-clobbering keys.

import type { NostrEvent } from "@thewired/shared-types";

export interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  lud16?: string;
  lud06?: string;
  website?: string;
  /** created_at of the kind-0 this came from — newest wins (replaceable). */
  created_at: number;
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parse kind:0 event content into a profile; null for anything malformed. */
export function parseProfile(event: NostrEvent): ProfileMetadata | null {
  if (event.kind !== 0) return null;

  let data: unknown;
  try {
    data = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const obj = data as Record<string, unknown>;

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;

  const profile: ProfileMetadata = { created_at: event.created_at };
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (
      key === "name" ||
      key === "display_name" ||
      key === "about" ||
      key === "picture" ||
      key === "banner" ||
      key === "nip05" ||
      key === "lud16" ||
      key === "lud06" ||
      key === "website"
    ) {
      const value = str(obj[key]);
      if (value !== undefined) profile[key] = value;
    }
  }
  return profile;
}

/** Preferred display name: display_name → name → shortened pubkey. */
export function profileDisplayName(
  profile: ProfileMetadata | undefined,
  pubkey: string,
): string {
  const name = profile?.display_name?.trim() || profile?.name?.trim();
  if (name) return name;
  return `${pubkey.slice(0, 8)}…`;
}
