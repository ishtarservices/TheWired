/**
 * Main-thread lag monitor.
 *
 * Runs a tiny `setInterval` and measures how late each tick actually fires
 * compared to its scheduled time. If the main thread is busy (a flood of
 * Redux dispatches, a sync render, a parse-heavy event burst, an iframe
 * starting up), the timer can't fire on time — the difference is "lag."
 *
 * This directly observes the "feels slow / unresponsive" symptom independent
 * of any specific subsystem: clicks won't dispatch and the UI can't paint
 * while the event loop is wedged. A 1s lag spike means the user experienced
 * ~1s of UI freeze at that moment.
 *
 * Thresholds tiered so the noise floor stays low:
 *  - <150 ms drift: ignored (normal scheduler jitter).
 *  - 150–500 ms: debug (briefly busy).
 *  - 500 ms – 1 s: info (noticeable hitch).
 *  - 1 s – 2 s: warn (user-visible freeze).
 *  - >2 s: error (severe).
 */
import { createLogger } from "./logger";

const log = createLogger("perf");
const INTERVAL_MS = 100;

let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
/** Total >150ms lag events since session start — used by wiredDebug.session(). */
const recentSpikes: Array<{ t: number; lagMs: number }> = [];
const SPIKE_BUFFER = 50;

export function startPerfMonitor(): void {
  if (timer !== null) return;
  lastTick = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    const drift = now - lastTick - INTERVAL_MS;
    lastTick = now;
    if (drift < 150) return;

    recentSpikes.push({ t: now, lagMs: drift });
    if (recentSpikes.length > SPIKE_BUFFER) recentSpikes.shift();

    const ms = Math.round(drift);
    if (drift >= 2000) log.error(`main-thread frozen ${ms}ms (severe)`);
    else if (drift >= 1000) log.warn(`main-thread frozen ${ms}ms (user-visible)`);
    else if (drift >= 500) log.info(`main-thread hitch ${ms}ms`);
    else log.debug(`main-thread brief stall ${ms}ms`);
  }, INTERVAL_MS);
}

export function stopPerfMonitor(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/** Recent lag spikes (>150 ms) — used by wiredDebug.session() for a quick health view. */
export function getRecentLagSpikes(): readonly { t: number; lagMs: number }[] {
  return recentSpikes;
}
