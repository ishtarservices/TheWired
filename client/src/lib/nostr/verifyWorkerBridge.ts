import type { NostrEvent } from "../../types/nostr";
import { verifyEventSync, type VerifiableEvent } from "./verifyEvent";

/** Per-verify timeout: how long to wait for the worker before treating it as
 *  stalled. */
const VERIFY_TIMEOUT_MS = 5_000;
/** Consecutive worker timeouts (with no healthy response between) that mark the
 *  worker as wedged and trigger a restart. */
const MAX_CONSECUTIVE_TIMEOUTS = 3;
/** If the worker restarts more than this many times within RESTART_WINDOW_MS,
 *  give up on it and verify on the main thread instead (fail-closed). */
const MAX_RESTARTS_PER_WINDOW = 2;
const RESTART_WINDOW_MS = 60_000;

interface PendingVerification {
  event: VerifiableEvent;
  resolve: (valid: boolean) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Main-thread bridge to the schnorr-verification Web Worker, with a watchdog:
 * - per-verify timers are cleared on settle (no timer leak per event);
 * - a wedged worker (3 consecutive timeouts, or an onerror) is restarted and all
 *   in-flight payloads are re-dispatched to the fresh worker;
 * - if the worker keeps dying (>2 restarts/60s) the bridge falls back to
 *   main-thread verification so events are still verified — never rendered
 *   unverified (fail-closed; see docs/AI_ENGINE.md-style trust contract for the
 *   pipeline). The fallback defers each verify to a microtask so a backfill burst
 *   doesn't block the main thread in one synchronous run.
 */
class VerifyWorkerBridge {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingVerification>();
  private nextId = 0;
  private consecutiveTimeouts = 0;
  private restartTimes: number[] = [];
  private mainThreadFallback = false;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("../../workers/verifyWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id } = e.data;
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          this.consecutiveTimeouts = 0; // a healthy response resets the streak
          p.resolve(type === "verified");
        }
      };
      this.worker.onerror = (e) => {
        console.error("[verify] worker error — restarting:", (e as ErrorEvent)?.message ?? e);
        this.restartWorker();
      };
    }
    return this.worker;
  }

  verify(event: NostrEvent): Promise<boolean> {
    const payload: VerifiableEvent = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    };

    if (this.mainThreadFallback) {
      // Fail-closed fallback. Defer to a microtask so a burst yields between events.
      return Promise.resolve().then(() => verifyEventSync(payload));
    }

    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.dispatch(id, payload, resolve, reject);
    });
  }

  private dispatch(
    id: number,
    event: VerifiableEvent,
    resolve: (valid: boolean) => void,
    reject: (err: Error) => void,
  ): void {
    const timer = setTimeout(() => this.onTimeout(id), VERIFY_TIMEOUT_MS);
    this.pending.set(id, { event, resolve, reject, timer });
    try {
      this.getWorker().postMessage({ type: "verify", id, event });
    } catch (err) {
      this.pending.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private onTimeout(id: number): void {
    const p = this.pending.get(id);
    if (!p) return; // already settled
    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
      // The worker looks wedged. restartWorker re-dispatches everything still
      // pending (including this id, which we deliberately leave in the map).
      this.restartWorker();
      return;
    }
    // An isolated timeout: drop this one (caller fail-closes), keep the worker.
    this.pending.delete(id);
    p.reject(new Error("Verification timeout"));
  }

  private restartWorker(): void {
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;

    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimes.push(now);
    if (this.restartTimes.length > MAX_RESTARTS_PER_WINDOW) {
      this.enterMainThreadFallback();
      return;
    }

    // Re-dispatch every in-flight payload to a fresh worker with new timers.
    const inflight = [...this.pending.values()];
    this.pending.clear();
    this.consecutiveTimeouts = 0;
    for (const p of inflight) {
      clearTimeout(p.timer);
      this.dispatch(this.nextId++, p.event, p.resolve, p.reject);
    }
  }

  private enterMainThreadFallback(): void {
    if (this.mainThreadFallback) return;
    this.mainThreadFallback = true;
    console.warn(
      "[verify] worker unstable (>2 restarts/60s) — verifying on the main thread (fail-closed)",
    );
    // Settle everything still in flight on the main thread.
    const inflight = [...this.pending.values()];
    this.pending.clear();
    for (const p of inflight) {
      clearTimeout(p.timer);
      p.resolve(verifyEventSync(p.event));
    }
  }

  /** Reject all in-flight verifications (used during account switch). */
  drainPending(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Account switched"));
    }
    this.pending.clear();
  }

  terminate(): void {
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Worker terminated"));
    }
    this.pending.clear();
  }
}

export const verifyBridge = new VerifyWorkerBridge();
/** Exported for tests (the singleton is globally mocked in vitest.setup). */
export { VerifyWorkerBridge };
