import { describe, it, expect, beforeEach } from "vitest";
import { getRedis } from "../../src/lib/redis.js";
import { runWithWorkerLock, startLockedInterval } from "../../src/lib/workerLock.js";

/**
 * The background workers are bare `setInterval`s started per process, so with
 * more than one backend replica every job ran once per replica — double-running
 * non-idempotent counters and, in the notification dispatcher's case, sending
 * the same push twice. These tests pin the mutual exclusion that fixes it.
 */

beforeEach(async () => {
  await getRedis().flushall();
});

/** A deferred, so a test can hold the lock open while it asserts. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("runWithWorkerLock", () => {
  it("runs exactly one of several concurrent attempts", async () => {
    const gate = deferred();
    let running = 0;
    let ran = 0;

    const attempt = () =>
      runWithWorkerLock("concurrent-job", 5000, async () => {
        running += 1;
        expect(running).toBe(1); // never two at once
        ran += 1;
        await gate.promise;
        running -= 1;
      });

    const results = Promise.all([attempt(), attempt(), attempt()]);
    gate.resolve();

    expect(await results).toEqual([true, false, false]);
    expect(ran).toBe(1);
  });

  it("releases the lock so the next tick can take it", async () => {
    const seen: number[] = [];
    for (const n of [1, 2, 3]) {
      const acquired = await runWithWorkerLock("sequential-job", 5000, async () => {
        seen.push(n);
      });
      expect(acquired).toBe(true);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(await getRedis().get("worker:lock:sequential-job")).toBeNull();
  });

  it("releases the lock when the task throws, and rethrows", async () => {
    await expect(
      runWithWorkerLock("throwing-job", 5000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await getRedis().get("worker:lock:throwing-job")).toBeNull();
    // Not poisoned: the next tick still runs.
    expect(await runWithWorkerLock("throwing-job", 5000, async () => {})).toBe(true);
  });

  it("does not run, or steal, a lock another replica holds", async () => {
    const redis = getRedis();
    await redis.set("worker:lock:held-job", "some-other-replica", "PX", 30_000);

    let ran = false;
    const acquired = await runWithWorkerLock("held-job", 5000, async () => {
      ran = true;
    });

    expect(acquired).toBe(false);
    expect(ran).toBe(false);
    // The other replica's lock must survive our attempt — releasing it here is
    // what would let two replicas run together from then on.
    expect(await redis.get("worker:lock:held-job")).toBe("some-other-replica");
  });

  it("scopes the lock to the job name", async () => {
    const gate = deferred();
    const first = runWithWorkerLock("job-a", 5000, () => gate.promise);
    const second = await runWithWorkerLock("job-b", 5000, async () => {});

    gate.resolve();
    expect(await first).toBe(true);
    expect(second).toBe(true);
  });
});

describe("startLockedInterval", () => {
  it("runs immediately when no initial delay is given", async () => {
    const first = deferred();
    let runs = 0;

    const job = startLockedInterval({
      name: "immediate-job",
      intervalMs: 60_000,
      task: async () => {
        runs += 1;
        first.resolve();
      },
    });

    await first.promise;
    job.stop();
    expect(runs).toBe(1);
  });

  it("waits for the initial delay before the first run", async () => {
    let runs = 0;
    const job = startLockedInterval({
      name: "delayed-job",
      intervalMs: 60_000,
      initialDelayMs: 60_000,
      task: async () => {
        runs += 1;
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    job.stop();
    expect(runs).toBe(0);
  });

  it("stops ticking after stop()", async () => {
    const first = deferred();
    let runs = 0;

    const job = startLockedInterval({
      name: "stoppable-job",
      intervalMs: 10,
      task: async () => {
        runs += 1;
        first.resolve();
      },
    });

    await first.promise;
    job.stop();
    const atStop = runs;

    await new Promise((r) => setTimeout(r, 60));
    expect(runs).toBe(atStop);
  });
});
