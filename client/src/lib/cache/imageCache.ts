/**
 * LRU image preload cache.
 *
 * Pre-decodes images using the browser's Image() constructor so that by the
 * time an <img> element renders with the same src, the browser already has the
 * decoded bitmap in memory and paints it instantly (no flash/flicker).
 *
 * Usage:
 *   imageCache.preload(url)           -- fire-and-forget warm
 *   imageCache.preloadMany(urls)      -- batch warm
 *   imageCache.has(url)               -- check if decoded
 *   imageCache.getObjectUrl(url)      -- get blob URL for zero-flicker src (optional)
 */

const DEFAULT_MAX_SIZE = 500;

interface CacheEntry {
  img: HTMLImageElement;
  /** blob URL created from the fetched image (for same-origin use) */
  objectUrl?: string;
  /** Timestamp of last access -- for LRU eviction */
  lastAccess: number;
}

class ImageCache {
  private cache = new Map<string, CacheEntry>();
  private loading = new Set<string>();
  private maxSize: number;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /** Pre-decode an image. Returns a promise that resolves when decoded. */
  preload(url: string): Promise<void> {
    // Already cached or loading
    if (this.cache.has(url)) {
      this.cache.get(url)!.lastAccess = Date.now();
      return Promise.resolve();
    }
    if (this.loading.has(url)) return Promise.resolve();

    this.loading.add(url);

    return new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";

      img.onload = () => {
        this.loading.delete(url);
        this.evictIfNeeded();
        this.cache.set(url, { img, lastAccess: Date.now() });

        // Use decode() for full pre-decode if available
        if (typeof img.decode === "function") {
          img.decode().then(() => resolve(), () => resolve());
        } else {
          resolve();
        }
      };

      img.onerror = () => {
        this.loading.delete(url);
        resolve(); // Don't reject -- caller doesn't need to handle
      };

      img.src = url;
    });
  }

  /** Batch preload. Non-blocking, best-effort. */
  preloadMany(urls: string[]): void {
    for (const url of urls) {
      this.preload(url);
    }
  }

  /** Check if an image is fully decoded in cache */
  has(url: string): boolean {
    return this.cache.has(url);
  }

  /** Check if an image is currently being loaded */
  isLoading(url: string): boolean {
    return this.loading.has(url);
  }

  /** Get cache stats */
  get size(): number {
    return this.cache.size;
  }

  /** Evict oldest entries if over capacity */
  private evictIfNeeded(): void {
    if (this.cache.size < this.maxSize) return;

    // Find oldest entries
    const entries = [...this.cache.entries()].sort(
      (a, b) => a[1].lastAccess - b[1].lastAccess,
    );

    // Remove oldest 20%
    const removeCount = Math.ceil(this.maxSize * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      const [key, entry] = entries[i];
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
      this.cache.delete(key);
    }
  }

  /** Clear the entire cache */
  clear(): void {
    for (const [, entry] of this.cache) {
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    this.cache.clear();
    this.loading.clear();
  }
}

/** Singleton image cache */
export const imageCache = new ImageCache();
