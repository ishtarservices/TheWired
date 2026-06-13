import { registerDebugCommand } from "../debug/logger";

/**
 * Bounded LRU of captured video first-frame posters, keyed by video URL and
 * stored as JPEG data URLs.
 *
 * The media feed paints a poster for thumbnail-less videos by mounting a <video>,
 * seeking ~0.1s, and decoding that frame (300–1100ms). Tiles unmount when they
 * scroll out of view (to bound live <video> count + connections), so without a
 * cache, scrolling back re-does the whole seek. This stashes the painted frame so
 * a re-entry renders a cheap <img> instead.
 *
 * Data URLs (not blob object-URLs) on purpose: no revoke lifecycle, and an evicted
 * entry can never break a still-rendered <img> (the string is self-contained).
 * Capacity-LRU bounds memory. Entries are also CORS-limited — a frame can only be
 * read off a `<video crossorigin="anonymous">` served with permissive CORS headers,
 * so this only ever holds the subset of hosts that allow it.
 */

const DEFAULT_MAX = 250;

interface PosterEntry {
  dataUrl: string;
  lastAccess: number;
}

class VideoPosterCache {
  private cache = new Map<string, PosterEntry>();
  private readonly maxSize: number;
  private captures = 0;
  private evictions = 0;

  constructor(maxSize = DEFAULT_MAX) {
    this.maxSize = maxSize;
  }

  /** Cached poster (marks it recently used), or undefined. */
  get(url: string): string | undefined {
    const entry = this.cache.get(url);
    if (!entry) return undefined;
    entry.lastAccess = Date.now();
    return entry.dataUrl;
  }

  /** Store a freshly-captured poster; refresh recency if already present. */
  set(url: string, dataUrl: string): void {
    const existing = this.cache.get(url);
    if (existing) {
      existing.lastAccess = Date.now();
      return;
    }
    this.evictIfNeeded();
    this.cache.set(url, { dataUrl, lastAccess: Date.now() });
    this.captures++;
  }

  /** Evict the oldest ~20% once at capacity (data URLs need no revoke). */
  private evictIfNeeded(): void {
    if (this.cache.size < this.maxSize) return;
    const entries = [...this.cache.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    );
    const removeCount = Math.ceil(this.maxSize * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
      this.evictions++;
    }
  }

  clear(): void {
    this.cache.clear();
  }

  stats() {
    return {
      size: this.cache.size,
      max: this.maxSize,
      captures: this.captures,
      evictions: this.evictions,
    };
  }
}

/** Singleton video-poster cache. */
export const videoPosterCache = new VideoPosterCache();

// Live snapshot: `wiredDebug.posterCache()` in the console — use to measure how
// many posters were captured (CORS-permitted) vs how the feed feels on re-scroll.
registerDebugCommand("posterCache", () => {
  const s = videoPosterCache.stats();
  // eslint-disable-next-line no-console
  console.info(
    `[wiredDebug.posterCache] size=${s.size}/${s.max} captures=${s.captures} evictions=${s.evictions}`,
  );
  return s;
});
