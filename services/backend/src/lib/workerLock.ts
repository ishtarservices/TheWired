import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";

/**
 * Single-runner guard for the periodic background workers.
 *
 * Every worker in `src/workers/` is a bare in-process `setInterval` started by
 * `src/index.ts`, so with more than one backend replica each job runs once per
 * replica. Most of these jobs write shared state (Redis counters, Meilisearch
 * documents, `app.*` rollups, push notifications), and several are not
 * idempotent under concurrency — the notification dispatcher in particular does
 * a non-atomic select-then-mark, so two replicas send the same push twice.
 *
 * A Redis lock per job name makes each tick run on exactly one replica. It is
 * intentionally a *mutual-exclusion* lock and not a scheduler: every replica
 * still ticks on its own interval and simply skips the tick it did not win, so
 * a replica dying mid-cycle costs at most one cycle rather than stopping the
 * job forever.
 */

const LOCK_PREFIX = "worker:lock:";

/** Floor for the lock TTL, so the renewal below always has room to land. */
const MIN_LOCK_TTL_MS = 5_000;

/**
 * Release only if we still own the lock. Without the compare-and-delete, a run
 * that overran its TTL would delete the lock a *different* replica had since
 * taken, letting two replicas run concurrently from then on.
 */
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

/** Same compare-and-swap, for extending a lock we still hold. */
const RENEW_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

/**
 * Identifies this process's ownership of a lock; regenerated per acquisition.
 *
 * The random component is load-bearing: replicas run in separate containers,
 * where the pid is very often 1, and the compare-and-swap release below is only
 * safe if two replicas can never mint the same token.
 */
const PROCESS_ID = `${process.pid}-${randomUUID()}`;
let acquisitionSeq = 0;
function newLockToken(): string {
  acquisitionSeq += 1;
  return `${PROCESS_ID}:${acquisitionSeq}`;
}

/**
 * Run `task` iff this process wins the lock named `name`.
 *
 * Returns `true` if the task ran here, `false` if another replica held the lock
 * (or Redis was unreachable — see below). Errors thrown by `task` propagate to
 * the caller after the lock is released.
 *
 * `ttlMs` is clamped to a 5s floor: the lock is renewed at a third of its TTL
 * while the task runs, so a TTL near the renewal cadence could expire before
 * the first renewal lands. Every real worker is far above the floor.
 *
 * If Redis itself fails we deliberately DO run the task: the workers keep a
 * single-replica deployment (and the whole dev/test setup) working when Redis
 * is down, and degrading to today's duplicate-work behaviour is strictly better
 * than silently stopping every background job.
 */
export async function runWithWorkerLock(
  name: string,
  ttlMs: number,
  task: () => Promise<void> | void,
): Promise<boolean> {
  const key = `${LOCK_PREFIX}${name}`;
  const token = newLockToken();
  const redis = getRedis();
  const ttl = Math.max(MIN_LOCK_TTL_MS, Math.floor(ttlMs));

  let acquired: string | null;
  try {
    acquired = await redis.set(key, token, "PX", ttl, "NX");
  } catch (err) {
    console.warn(
      `[workerLock] ${name}: Redis unavailable (${(err as Error).message}) — running unguarded`,
    );
    await task();
    return true;
  }

  if (acquired !== "OK") return false;

  // Keep the lock alive for as long as the task actually runs, so a slow pass
  // never has its lock expire out from under it.
  const renewTimer = setInterval(() => {
    redis.eval(RENEW_LUA, 1, key, token, String(ttl)).catch(() => {});
  }, Math.floor(ttl / 3));
  // Never hold the event loop open just to renew a lock.
  renewTimer.unref?.();

  try {
    await task();
    return true;
  } finally {
    clearInterval(renewTimer);
    await redis.eval(RELEASE_LUA, 1, key, token).catch(() => {});
  }
}

export interface LockedIntervalOptions {
  /** Stable job name — forms the Redis lock key, so it must not vary per replica. */
  name: string;
  intervalMs: number;
  /** Delay before the first run. Defaults to 0 (run immediately on start). */
  initialDelayMs?: number;
  /**
   * How long the lock survives a crashed holder. Defaults to `intervalMs`, and
   * is renewed while the task runs, so this only bounds recovery after a hard
   * crash — not how long a slow job may take.
   */
  lockTtlMs?: number;
  task: () => Promise<void> | void;
}

/**
 * `setInterval`, except each tick runs on at most one replica.
 *
 * Ticks are also non-overlapping within a process: the lock is held for the
 * whole run, so a pass that takes longer than the interval makes the next tick
 * a no-op instead of piling up.
 */
export function startLockedInterval(opts: LockedIntervalOptions): { stop: () => void } {
  const { name, intervalMs, initialDelayMs = 0, lockTtlMs = intervalMs, task } = opts;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      await runWithWorkerLock(name, lockTtlMs, task);
    } catch (err) {
      // Workers already log their own failures; this is the backstop so one
      // bad pass can never kill the interval.
      console.error(`[workerLock] ${name} failed:`, (err as Error).message);
    }
  }

  const interval = setInterval(() => void tick(), intervalMs);

  let initial: ReturnType<typeof setTimeout> | null = null;
  if (initialDelayMs > 0) {
    initial = setTimeout(() => void tick(), initialDelayMs);
  } else {
    void tick();
  }

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      if (initial) clearTimeout(initial);
    },
  };
}
