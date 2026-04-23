/**
 * Run async thunks with bounded concurrency.
 *
 * Results preserve input order. Failures are captured per-task, never thrown —
 * the returned promise always settles. Callers inspect each result's `status`
 * to decide what to do with successes vs errors.
 */
export async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  maxInFlight: number,
): Promise<PromiseSettledResult<T>[]> {
  if (maxInFlight < 1) {
    throw new Error("maxInFlight must be >= 1");
  }
  if (tasks.length === 0) return [];

  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.min(maxInFlight, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
