/**
 * Centralized API request queue with concurrency limiting and global 429 backoff.
 *
 * All HTTP requests are routed through this queue so that:
 * 1. No more than `maxConcurrent` requests are in-flight at once
 * 2. Higher-priority requests (channels, permissions) execute before lower ones
 * 3. A single 429 response pauses ALL queued requests for the Retry-After period
 *    instead of each request retrying independently (thundering herd)
 */

export type RequestPriority = "high" | "normal" | "low";

const PRIORITY_ORDER: Record<RequestPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

interface QueueEntry<T = unknown> {
  execute: () => Promise<T>;
  priority: RequestPriority;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const MAX_CONCURRENT = 6;
const MAX_BACKOFF_SECONDS = 30;
const MAX_QUEUE_SIZE = 50;

class RequestQueue {
  private queue: QueueEntry[] = [];
  private activeCount = 0;
  private globalBackoffUntil = 0;
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Enqueue a request to be executed when a slot is available.
   * Returns a promise that resolves/rejects with the request's result.
   */
  enqueue<T>(execute: () => Promise<T>, priority: RequestPriority = "normal"): Promise<T> {
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error("API request queue full"));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { execute, priority, resolve, reject };
      this.insertByPriority(entry as QueueEntry);
      this.drain();
    });
  }

  /**
   * Pause all queued requests for `seconds` (capped at MAX_BACKOFF_SECONDS).
   * In-flight requests continue — only new dispatches are delayed.
   */
  triggerGlobalBackoff(seconds: number): void {
    const capped = Math.min(Math.max(seconds, 1), MAX_BACKOFF_SECONDS);
    const until = Date.now() + capped * 1000;
    // Only extend, never shorten an active backoff
    if (until > this.globalBackoffUntil) {
      this.globalBackoffUntil = until;
    }
    this.scheduleDrain();
  }

  /** Insert maintaining priority order (FIFO within each priority level). */
  private insertByPriority(entry: QueueEntry): void {
    const entryOrder = PRIORITY_ORDER[entry.priority];
    // Find the first item with strictly lower priority (higher number)
    const idx = this.queue.findIndex(
      (e) => PRIORITY_ORDER[e.priority] > entryOrder,
    );
    if (idx === -1) {
      this.queue.push(entry);
    } else {
      this.queue.splice(idx, 0, entry);
    }
  }

  /** Dispatch queued requests up to the concurrency limit. */
  private drain(): void {
    const now = Date.now();

    // If in global backoff, schedule a drain for when it expires
    if (now < this.globalBackoffUntil) {
      this.scheduleDrain();
      return;
    }

    while (this.activeCount < MAX_CONCURRENT && this.queue.length > 0) {
      const entry = this.queue.shift()!;
      this.activeCount++;

      entry
        .execute()
        .then((value) => entry.resolve(value))
        .catch((err) => entry.reject(err))
        .finally(() => {
          this.activeCount--;
          this.drain();
        });
    }
  }

  /** Schedule a single drain call when the backoff expires. */
  private scheduleDrain(): void {
    if (this.backoffTimer !== null) return; // already scheduled
    const remaining = this.globalBackoffUntil - Date.now();
    if (remaining <= 0) {
      this.drain();
      return;
    }
    this.backoffTimer = setTimeout(() => {
      this.backoffTimer = null;
      this.drain();
    }, remaining);
  }
}

/** Module-level singleton — import and use directly. */
export const requestQueue = new RequestQueue();
