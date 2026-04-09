import { LRUCache } from "lru-cache";

/**
 * Event deduplicator using a single LRU cache.
 *
 * Previous implementation used a Bloom filter + LRU combo, but the LRU was the
 * effective dedup bottleneck (Bloom false positives couldn't be confirmed after
 * LRU eviction). A single larger LRU is simpler, has zero false positives, and
 * supports `unmarkSeen` naturally.
 *
 * At 100k entries of 64-char hex IDs, memory usage is ~15 MB — fine for desktop.
 */
const LRU_CAPACITY = 100_000;

export class EventDeduplicator {
  private seen = new LRUCache<string, true>({ max: LRU_CAPACITY });

  isDuplicate(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  markSeen(eventId: string): void {
    this.seen.set(eventId, true);
  }

  /** Remove from cache so the event can be retried from another relay. */
  unmarkSeen(eventId: string): void {
    this.seen.delete(eventId);
  }

  /** Full clear — used during account switch */
  clear(): void {
    this.seen.clear();
  }
}
