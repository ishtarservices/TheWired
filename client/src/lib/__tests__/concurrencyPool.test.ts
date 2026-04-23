import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../concurrencyPool";

describe("runWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const tasks = [50, 10, 30, 5, 20].map((ms, i) =>
      () => new Promise<number>((r) => setTimeout(() => r(i), ms)),
    );
    const results = await runWithConcurrency(tasks, 3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : -1))).toEqual([0, 1, 2, 3, 4]);
  });

  it("captures per-task errors without throwing", async () => {
    const tasks: Array<() => Promise<string>> = [
      async () => "ok1",
      async () => { throw new Error("boom"); },
      async () => "ok2",
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok1" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "ok2" });
  });

  it("never exceeds max in-flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
    });
    await runWithConcurrency(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input", async () => {
    const results = await runWithConcurrency([], 3);
    expect(results).toEqual([]);
  });

  it("rejects invalid concurrency", async () => {
    await expect(runWithConcurrency([async () => 1], 0)).rejects.toThrow();
  });
});
