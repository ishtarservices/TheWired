import { registerDebugCommand } from "../debug/logger";
import { getMusicAccess, type MusicAccess } from "@/lib/api/music";

/**
 * Bounded, expiry-aware cache of media capability-token grants, keyed by a track's
 * addressable id (`31683:pubkey:dTag`). A private track needs a `?tk=` grant fetched
 * via a signed `/music/access` call; caching it means seeks, re-plays, and next-track
 * transitions don't re-sign. Positive grants live until just before the token expiry;
 * denials are negative-cached briefly so a 404 doesn't re-sign on every render.
 */

const DEFAULT_MAX = 200;
const NEGATIVE_TTL_MS = 30_000;
const PUBLIC_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 60_000; // refresh a gated grant 60s before its token expires

interface TokenEntry {
  access: MusicAccess | null; // null = cached denial (unauthorized / signed-out)
  expiresAt: number;
  lastAccess: number;
}

class TokenCache {
  private cache = new Map<string, TokenEntry>();
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_MAX) {
    this.maxSize = maxSize;
  }

  /** Cached grant (may be a `null` access = cached denial), or undefined if absent/expired. */
  get(key: string): { access: MusicAccess | null } | undefined {
    const e = this.cache.get(key);
    if (!e) return undefined;
    if (Date.now() >= e.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    e.lastAccess = Date.now();
    return { access: e.access };
  }

  set(key: string, access: MusicAccess | null): void {
    const now = Date.now();
    let expiresAt: number;
    if (access && access.gated) {
      expiresAt = Math.max(now, access.exp * 1000 - REFRESH_MARGIN_MS);
    } else if (access) {
      expiresAt = now + PUBLIC_TTL_MS; // gated:false — stable for the session
    } else {
      expiresAt = now + NEGATIVE_TTL_MS; // denial — retry soon (e.g. after sign-in)
    }
    this.evictIfNeeded();
    this.cache.set(key, { access, expiresAt, lastAccess: now });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxSize) return;
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const removeCount = Math.ceil(this.maxSize * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  stats() {
    return { size: this.cache.size, max: this.maxSize };
  }
}

/** Singleton media-token cache. */
export const musicTokenCache = new TokenCache();

/**
 * Cache-first resolution of a track's media access grant. Returns the grant
 * (`{gated:false}` / `{gated:true,…}`) or `null` when access can't be obtained.
 */
export async function resolveMusicAccess(addressableId: string): Promise<MusicAccess | null> {
  const cached = musicTokenCache.get(addressableId);
  if (cached) return cached.access;
  const access = await getMusicAccess(addressableId);
  musicTokenCache.set(addressableId, access);
  return access;
}

registerDebugCommand("musicTokenCache", () => {
  const s = musicTokenCache.stats();
  // eslint-disable-next-line no-console
  console.info(`[wiredDebug.musicTokenCache] size=${s.size}/${s.max}`);
  return s;
});
