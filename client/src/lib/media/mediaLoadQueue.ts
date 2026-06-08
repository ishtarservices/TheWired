/**
 * Bounded-concurrency queue for media-tile loads.
 *
 * A media-only feed mounts many <video> tiles at once; each one loading metadata
 * + seeking a frame opens a connection. Browsers cap ~6 connections/host, so an
 * unbounded burst saturates the pool — starving the relay WebSockets and the
 * actual clip the user clicks to play. This semaphore caps how many tiles load
 * concurrently; the rest wait their turn (FIFO), so loads happen in waves.
 *
 * It's a classic counting semaphore / bounded buffer: `acquire()` resolves when
 * a slot is free, `release()` hands the slot to the next waiter (or frees it).
 */

export interface QueueStats {
  active: number;
  waiting: number;
  max: number;
}

export class MediaLoadQueue {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  /** Resolves immediately if a slot is free, else when one frees up. */
  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Release a held slot — hands it straight to the next waiter if any. */
  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Slot transfers to the waiter; `active` stays the same.
      next();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  stats(): QueueStats {
    return { active: this.active, waiting: this.waiters.length, max: this.max };
  }
}

/** How many video tiles may load (metadata + first-frame seek) at once. */
const MAX_CONCURRENT_VIDEO_LOADS = 4;

/** Shared queue for video-thumbnail frame loads across the media feed. */
export const videoLoadQueue = new MediaLoadQueue(MAX_CONCURRENT_VIDEO_LOADS);

// Live snapshot of the video load queue: `wiredDebug.mediaQueue()` in the console.
import { registerDebugCommand } from "../debug/logger";
registerDebugCommand("mediaQueue", () => {
  const s = videoLoadQueue.stats();
  // eslint-disable-next-line no-console
  console.info(`[wiredDebug.mediaQueue] active=${s.active}/${s.max} waiting=${s.waiting}`);
  return s;
});
