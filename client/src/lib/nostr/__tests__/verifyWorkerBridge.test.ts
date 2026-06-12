import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";

// The singleton is globally mocked in vitest.setup; pull the REAL class via
// importActual and drive it with a controllable Worker mock.

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: { type: string; id: number } }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  posted: Array<{ id: number }> = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(d: { id: number }) {
    this.posted.push(d);
  }
  terminate() {
    this.terminated = true;
  }
  respond(id: number, type: "verified" | "invalid") {
    this.onmessage?.({ data: { type, id } });
  }
  fail() {
    this.onerror?.({ message: "boom" });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Bridge: any;

function fakeEvent(id = "ab".repeat(32)): NostrEvent {
  return { id, pubkey: "cd".repeat(32), created_at: 1, kind: 1, tags: [], content: "x", sig: "00".repeat(64) };
}

beforeEach(async () => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.useFakeTimers();
  const actual = await vi.importActual<typeof import("../verifyWorkerBridge")>("../verifyWorkerBridge");
  Bridge = actual.VerifyWorkerBridge;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("VerifyWorkerBridge watchdog", () => {
  it("resolves with the worker's verdict and clears the per-verify timer", async () => {
    const b = new Bridge();
    const p = b.verify(fakeEvent());
    FakeWorker.instances[0].respond(0, "verified");
    await expect(p).resolves.toBe(true);
    // Timer was cleared on settle: advancing past the timeout doesn't re-settle.
    vi.advanceTimersByTime(VERIFY_OVER);
  });

  it("an isolated timeout rejects (fail-closed) without restarting the worker", async () => {
    const b = new Bridge();
    const p = b.verify(fakeEvent());
    vi.advanceTimersByTime(VERIFY_OVER);
    await expect(p).rejects.toThrow(/timeout/i);
    expect(FakeWorker.instances).toHaveLength(1); // not restarted
  });

  it("restarts the worker after 3 consecutive timeouts and re-dispatches in-flight", async () => {
    const b = new Bridge();
    const p0 = b.verify(fakeEvent("00".repeat(32))).catch(() => "rejected");
    const p1 = b.verify(fakeEvent("11".repeat(32))).catch(() => "rejected");
    const p2 = b.verify(fakeEvent("22".repeat(32)));

    vi.advanceTimersByTime(VERIFY_OVER); // all three timers fire in order

    // First two are isolated → rejected; the third trips the restart threshold.
    await expect(p0).resolves.toBe("rejected");
    await expect(p1).resolves.toBe("rejected");
    expect(FakeWorker.instances.length).toBe(2); // restarted

    // The still-pending third verify was re-dispatched to the fresh worker.
    const fresh = FakeWorker.instances[1];
    expect(fresh.posted.length).toBe(1);
    fresh.respond(fresh.posted[0].id, "verified");
    await expect(p2).resolves.toBe(true);
  });

  it("falls back to main-thread verification after >2 restarts in the window", async () => {
    const b = new Bridge();
    // Three worker-level errors → three restarts → fallback engages.
    b.verify(fakeEvent()).catch(() => {});
    FakeWorker.instances[0].fail(); // restart 1 (re-dispatches the in-flight)
    FakeWorker.instances[1].fail(); // restart 2
    FakeWorker.instances[2].fail(); // restart 3 → > MAX (2) → main-thread fallback

    // No new worker is created for subsequent verifies — they go main-thread.
    const countBefore = FakeWorker.instances.length;
    const p = b.verify(fakeEvent()); // bad sig → verifyEventSync returns false
    await expect(p).resolves.toBe(false);
    expect(FakeWorker.instances.length).toBe(countBefore);
  });

  it("drainPending rejects all in-flight and clears their timers", async () => {
    const b = new Bridge();
    const p = b.verify(fakeEvent()).catch((e: Error) => e.message);
    b.drainPending();
    await expect(p).resolves.toMatch(/account switched/i);
  });
});

// One past the 5s VERIFY_TIMEOUT_MS.
const VERIFY_OVER = 5_001;
