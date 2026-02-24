import { RECONNECT } from "./constants";

/** Compute backoff delay with jitter */
export function computeBackoff(attempt: number): number {
  const exponential = Math.min(
    RECONNECT.BASE_DELAY * Math.pow(2, attempt),
    RECONNECT.MAX_DELAY,
  );
  const jitter = exponential * RECONNECT.JITTER * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/** Detect reconnection storms (multiple relays dropping at once) */
export class StormDetector {
  private disconnectTimestamps: number[] = [];

  recordDisconnect(): void {
    const now = Date.now();
    this.disconnectTimestamps.push(now);
    // Prune old entries
    this.disconnectTimestamps = this.disconnectTimestamps.filter(
      (t) => now - t < RECONNECT.STORM_WINDOW,
    );
  }

  isStorm(): boolean {
    return this.disconnectTimestamps.length >= RECONNECT.STORM_THRESHOLD;
  }

  getCooldown(): number {
    return this.isStorm() ? RECONNECT.STORM_COOLDOWN : 0;
  }
}
