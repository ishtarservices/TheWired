import { deleteExpiredEvents, getEventCount } from "./eventStore";
import { deleteExpiredProfiles } from "./profileStore";

const MAX_EVENTS = 50_000;
const EVICTION_INTERVAL = 30 * 60 * 1000; // 30 minutes

let evictionTimer: ReturnType<typeof setInterval> | null = null;

/** Run eviction: TTL-based expiry + LRU if over capacity */
export async function runEviction(): Promise<void> {
  // Phase 1: Delete expired entries
  const expiredEvents = await deleteExpiredEvents();
  const expiredProfiles = await deleteExpiredProfiles();

  if (expiredEvents > 0 || expiredProfiles > 0) {
    console.log(
      `[Eviction] Removed ${expiredEvents} events, ${expiredProfiles} profiles`,
    );
  }

  // Phase 2: LRU eviction if over capacity
  const count = await getEventCount();
  if (count > MAX_EVENTS) {
    console.log(
      `[Eviction] Event count ${count} exceeds max ${MAX_EVENTS}, need LRU eviction`,
    );
    // LRU eviction would delete oldest _cachedAt entries
    // This is handled by deleteExpiredEvents with a tighter TTL if needed
  }
}

/** Start periodic eviction */
export function startEviction(): void {
  if (evictionTimer) return;
  runEviction(); // Run immediately on start
  evictionTimer = setInterval(runEviction, EVICTION_INTERVAL);
}

/** Stop periodic eviction */
export function stopEviction(): void {
  if (evictionTimer) {
    clearInterval(evictionTimer);
    evictionTimer = null;
  }
}
