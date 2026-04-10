import { describe, it, expect, beforeEach } from "vitest";
import { EventDeduplicator } from "../dedup";

describe("EventDeduplicator", () => {
  let dedup: EventDeduplicator;

  beforeEach(() => {
    dedup = new EventDeduplicator();
  });

  it("returns false for new event IDs", () => {
    expect(dedup.isDuplicate("abc123")).toBe(false);
  });

  it("returns true after markSeen", () => {
    dedup.markSeen("abc123");
    expect(dedup.isDuplicate("abc123")).toBe(true);
  });

  it("returns false for different event IDs", () => {
    dedup.markSeen("abc123");
    expect(dedup.isDuplicate("def456")).toBe(false);
  });

  it("unmarkSeen allows re-processing", () => {
    dedup.markSeen("abc123");
    expect(dedup.isDuplicate("abc123")).toBe(true);

    dedup.unmarkSeen("abc123");
    expect(dedup.isDuplicate("abc123")).toBe(false);
  });

  it("clear resets all state", () => {
    dedup.markSeen("abc123");
    dedup.markSeen("def456");

    dedup.clear();

    expect(dedup.isDuplicate("abc123")).toBe(false);
    expect(dedup.isDuplicate("def456")).toBe(false);
  });

  it("handles many event IDs without error", () => {
    for (let i = 0; i < 1000; i++) {
      const id = `event-${i}`;
      expect(dedup.isDuplicate(id)).toBe(false);
      dedup.markSeen(id);
      expect(dedup.isDuplicate(id)).toBe(true);
    }
  });

  it("evicts oldest entries when LRU capacity (100K) is exceeded", () => {
    // Fill to capacity + 1
    const CAPACITY = 100_000;
    for (let i = 0; i <= CAPACITY; i++) {
      dedup.markSeen(`evt-${i}`);
    }
    // The first entry should have been evicted
    expect(dedup.isDuplicate("evt-0")).toBe(false);
    // The last entry should still be present
    expect(dedup.isDuplicate(`evt-${CAPACITY}`)).toBe(true);
  });
});
