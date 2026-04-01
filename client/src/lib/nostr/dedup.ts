import { SimpleBloomFilter } from "./bloomFilter";
import { LRUCache } from "lru-cache";

const BLOOM_CAPACITY = 100_000;
const BLOOM_FPR = 0.01;
const LRU_CAPACITY = 10_000;
const RESET_THRESHOLD = 50_000;

export class EventDeduplicator {
  private bloom: SimpleBloomFilter;
  private recentIds: LRUCache<string, true>;
  private count = 0;

  constructor() {
    this.bloom = new SimpleBloomFilter(BLOOM_CAPACITY, BLOOM_FPR);
    this.recentIds = new LRUCache<string, true>({ max: LRU_CAPACITY });
  }

  isDuplicate(eventId: string): boolean {
    if (this.bloom.has(eventId)) {
      // Bloom says maybe-yes: check LRU for definitive answer
      return this.recentIds.has(eventId);
    }
    return false;
  }

  markSeen(eventId: string): void {
    this.bloom.add(eventId);
    this.recentIds.set(eventId, true);
    this.count++;

    if (this.count >= RESET_THRESHOLD) {
      this.reset();
    }
  }

  /** Remove from LRU so the event can be retried from another relay.
   *  Bloom filter can't be cleared, but isDuplicate requires both bloom + LRU. */
  unmarkSeen(eventId: string): void {
    this.recentIds.delete(eventId);
  }

  reset(): void {
    this.bloom = new SimpleBloomFilter(BLOOM_CAPACITY, BLOOM_FPR);
    this.count = 0;
    // Keep LRU intact for continuity
  }
}
