import { describe, it, expect } from "vitest";
import { MediaLoadQueue } from "../mediaLoadQueue";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("MediaLoadQueue", () => {
  it("admits up to `max` acquirers immediately, queues the rest", async () => {
    const q = new MediaLoadQueue(2);

    let aDone = false;
    let bDone = false;
    let cDone = false;
    q.acquire().then(() => (aDone = true));
    q.acquire().then(() => (bDone = true));
    q.acquire().then(() => (cDone = true));
    await tick();

    expect(aDone).toBe(true);
    expect(bDone).toBe(true);
    expect(cDone).toBe(false); // third waits
    expect(q.stats()).toEqual({ active: 2, waiting: 1, max: 2 });
  });

  it("hands a released slot to the next waiter (active stays at max)", async () => {
    const q = new MediaLoadQueue(1);

    let secondAdmitted = false;
    await q.acquire(); // holds the only slot
    q.acquire().then(() => (secondAdmitted = true));
    await tick();
    expect(secondAdmitted).toBe(false);
    expect(q.stats()).toEqual({ active: 1, waiting: 1, max: 1 });

    q.release(); // transfer to the waiter
    await tick();
    expect(secondAdmitted).toBe(true);
    expect(q.stats()).toEqual({ active: 1, waiting: 0, max: 1 });
  });

  it("frees the slot when no one is waiting", async () => {
    const q = new MediaLoadQueue(2);
    await q.acquire();
    await q.acquire();
    expect(q.stats().active).toBe(2);
    q.release();
    expect(q.stats().active).toBe(1);
    q.release();
    expect(q.stats().active).toBe(0);
  });

  it("never drops below zero active", () => {
    const q = new MediaLoadQueue(1);
    q.release();
    q.release();
    expect(q.stats().active).toBe(0);
  });
});
