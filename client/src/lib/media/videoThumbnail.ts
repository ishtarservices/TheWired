/**
 * Auto-generates video thumbnail by capturing a frame via canvas.
 * Caches generated thumbnails in memory so each URL is only processed once.
 */

const cache = new Map<string, string>(); // videoUrl -> dataUrl
const pending = new Map<string, Promise<string | null>>(); // in-flight requests

/** Seek target in seconds -- skip past black intro frames */
const SEEK_TIME = 2;
/** Max time to wait for the video to load/seek (ms) */
const TIMEOUT = 8000;
/** Thumbnail quality (0-1) for JPEG encoding */
const QUALITY = 0.7;
/** Max thumbnail dimensions to keep data URLs small */
const MAX_WIDTH = 320;
const MAX_HEIGHT = 320;

// ── Concurrency limiter ─────────────────────────────────────────
// Generating thumbnails creates HTMLVideoElement + downloads video data.
// Too many concurrent generations saturate browser connections and
// starve WebSocket relay subs, causing the app to freeze.

const MAX_CONCURRENT = 3;
let activeCount = 0;
const queue: Array<{ url: string; resolve: (v: string | null) => void }> = [];

function enqueue(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    queue.push({ url, resolve });
    drainQueue();
  });
}

function drainQueue(): void {
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    activeCount++;
    captureFrame(job.url)
      .then((dataUrl) => {
        if (dataUrl) cache.set(job.url, dataUrl);
        job.resolve(dataUrl);
      })
      .catch(() => job.resolve(null))
      .finally(() => {
        activeCount--;
        pending.delete(job.url);
        drainQueue();
      });
  }
}

/**
 * Generates a thumbnail data URL for a video.
 * Returns null if the video can't be loaded or captured.
 * Results are cached -- calling with the same URL returns the cached result.
 * Concurrent generations are capped to avoid saturating browser connections.
 */
export function generateVideoThumbnail(
  videoUrl: string,
): Promise<string | null> {
  // Return cached result
  const cached = cache.get(videoUrl);
  if (cached) return Promise.resolve(cached);

  // Deduplicate in-flight requests
  const inflight = pending.get(videoUrl);
  if (inflight) return inflight;

  const promise = enqueue(videoUrl);
  pending.set(videoUrl, promise);
  return promise;
}

/** Check if a thumbnail is already cached for this URL */
export function hasCachedThumbnail(videoUrl: string): boolean {
  return cache.has(videoUrl);
}

/** Get a cached thumbnail without generating one */
export function getCachedThumbnail(videoUrl: string): string | undefined {
  return cache.get(videoUrl);
}

function captureFrame(videoUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, TIMEOUT);

    function cleanup() {
      clearTimeout(timeoutId);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      video.removeEventListener("loadeddata", onLoaded);
      video.src = "";
      video.load();
    }

    function onError() {
      cleanup();
      resolve(null);
    }

    function onSeeked() {
      try {
        // Calculate scaled dimensions
        let w = video.videoWidth;
        let h = video.videoHeight;
        if (w === 0 || h === 0) {
          cleanup();
          resolve(null);
          return;
        }

        const scale = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h, 1);
        w = Math.round(w * scale);
        h = Math.round(h * scale);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          resolve(null);
          return;
        }

        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
        cleanup();
        resolve(dataUrl);
      } catch {
        // CORS or other canvas taint errors
        cleanup();
        resolve(null);
      }
    }

    function onLoaded() {
      // Seek to SEEK_TIME or midpoint if video is shorter
      const target = video.duration > SEEK_TIME * 2 ? SEEK_TIME : video.duration * 0.25;
      video.currentTime = target;
    }

    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });

    video.src = videoUrl;
  });
}
