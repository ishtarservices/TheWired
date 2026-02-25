import type { Kind0Profile } from "../../types/profile";
import { getDB } from "./database";

const PROFILE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function putProfile(
  pubkey: string,
  profile: Kind0Profile,
): Promise<void> {
  const db = await getDB();

  // Freshness guard: skip write if incoming is older than existing
  if (profile.created_at) {
    const existing = await db.get("profiles", pubkey);
    if (existing?.created_at && profile.created_at < existing.created_at) {
      return;
    }
  }

  await db.put("profiles", {
    pubkey,
    ...profile,
    _cachedAt: Date.now(),
  });
}

export async function getProfile(
  pubkey: string,
): Promise<Kind0Profile | undefined> {
  const db = await getDB();
  const stored = await db.get("profiles", pubkey);
  if (!stored) return undefined;

  // Check TTL
  if (Date.now() - stored._cachedAt > PROFILE_TTL) {
    return undefined; // Stale
  }

  return {
    name: stored.name,
    display_name: stored.display_name,
    about: stored.about,
    picture: stored.picture,
    banner: stored.banner,
    nip05: stored.nip05,
    lud16: stored.lud16,
    website: stored.website,
    created_at: stored.created_at,
  };
}

export async function deleteExpiredProfiles(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("profiles", "readwrite");
  const now = Date.now();
  let deleted = 0;

  let cursor = await tx.store.index("by_cached_at").openCursor();
  while (cursor) {
    if (now - cursor.value._cachedAt > PROFILE_TTL) {
      await cursor.delete();
      deleted++;
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return deleted;
}
