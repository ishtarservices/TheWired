import { describe, it, expect } from "vitest";
import { requestQueue } from "../requestQueue";

describe("requestQueue", () => {
  it("executes requests up to concurrency limit", async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    const results: number[] = [];

    const tasks = Array.from({ length: 10 }, (_, i) =>
      requestQueue.enqueue(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 10));
        concurrentCount--;
        results.push(i);
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(results).toHaveLength(10);
    expect(maxConcurrent).toBeLessThanOrEqual(6);
  });

  it("respects priority ordering", async () => {
    const order: string[] = [];
    // Gate to hold all requests until we've queued them all
    let releaseGate: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });

    // Fill all 6 slots with blocking tasks
    const blockers = Array.from({ length: 6 }, (_, i) =>
      requestQueue.enqueue(async () => {
        await gate;
        return `blocker-${i}`;
      }),
    );

    // Now queue tasks at different priorities — these will wait for slots
    const low = requestQueue.enqueue(async () => { order.push("low"); return "low"; }, "low");
    const high = requestQueue.enqueue(async () => { order.push("high"); return "high"; }, "high");
    const normal = requestQueue.enqueue(async () => { order.push("normal"); return "normal"; }, "normal");

    // Release the blockers
    releaseGate!();
    await Promise.all(blockers);
    await Promise.all([low, high, normal]);

    // High should execute before normal, normal before low
    expect(order.indexOf("high")).toBeLessThan(order.indexOf("normal"));
    expect(order.indexOf("normal")).toBeLessThan(order.indexOf("low"));
  });

  it("global backoff delays queued requests", async () => {
    const start = Date.now();
    requestQueue.triggerGlobalBackoff(1); // 1 second backoff

    const result = await requestQueue.enqueue(async () => {
      return Date.now() - start;
    }, "low");

    // The request should have been delayed by roughly 1 second
    expect(result).toBeGreaterThanOrEqual(800);
  });

  it("propagates errors from the executed function", async () => {
    await expect(
      requestQueue.enqueue(async () => {
        throw new Error("test error");
      }),
    ).rejects.toThrow("test error");
  });

  it("continues draining after a task fails", async () => {
    const results: string[] = [];

    await Promise.allSettled([
      requestQueue.enqueue(async () => { throw new Error("fail"); }),
      requestQueue.enqueue(async () => { results.push("ok"); return "ok"; }),
    ]);

    expect(results).toContain("ok");
  });
});
