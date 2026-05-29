import { api } from "./client";
import type { Kind0Profile } from "../../types/profile";

/** Shape returned by the backend profile cache (app.cached_profiles). */
export interface CachedProfile {
  pubkey: string;
  name: string | null;
  displayName: string | null;
  picture: string | null;
  about: string | null;
  nip05: string | null;
  banner: string | null;
  lud16: string | null;
  website: string | null;
  /** kind:0 created_at — the version. Null on legacy rows cached before versioning. */
  createdAt: number | null;
  fetchedAt: number;
}

export async function getProfile(pubkey: string) {
  return api<CachedProfile>(`/profiles/${encodeURIComponent(pubkey)}`, { auth: false });
}

export async function batchProfiles(pubkeys: string[], signal?: AbortSignal) {
  return api<CachedProfile[]>("/profiles/batch", { method: "POST", body: { pubkeys }, auth: false, signal });
}

/** Convert a backend CachedProfile into a client Kind0Profile + its version (created_at). */
export function cachedProfileToKind0(p: CachedProfile): { profile: Kind0Profile; createdAt: number } {
  const profile: Kind0Profile = {};
  if (p.name) profile.name = p.name;
  if (p.displayName) profile.display_name = p.displayName;
  if (p.picture) profile.picture = p.picture;
  if (p.about) profile.about = p.about;
  if (p.nip05) profile.nip05 = p.nip05;
  if (p.banner) profile.banner = p.banner;
  if (p.lud16) profile.lud16 = p.lud16;
  if (p.website) profile.website = p.website;
  const createdAt = p.createdAt ?? 0;
  if (createdAt > 0) profile.created_at = createdAt;
  return { profile, createdAt };
}
