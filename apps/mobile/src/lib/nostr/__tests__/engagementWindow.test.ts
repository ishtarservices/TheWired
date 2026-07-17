import { EngagementWindow, type EngagementSubscriber } from "../engagementWindow";

// Desktop engagementCollector.test.ts cases, adapted to the mobile seam:
// the pool's same-sub-id filter replacement makes "close the previous batch"
// implicit, so assertions check subscribeEngagement's id batches instead of
// explicit close calls.

function makeSub() {
  return {
    subscribeEngagement: jest.fn(),
    unsubscribeEngagement: jest.fn(),
  } satisfies EngagementSubscriber;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("EngagementWindow", () => {
  it("fetches engagement for visible notes in feed order", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.report("b", 1, true);
    w.report("a", 0, true);
    w.flush();
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(1);
    expect(sub.subscribeEngagement).toHaveBeenCalledWith(["a", "b"]); // sorted by index
    w.dispose();
  });

  it("fetches each note only once when the visible set is unchanged", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.report("a", 0, true);
    w.flush();
    w.report("a", 0, true); // still visible, already fetched
    w.flush();
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it("fetches only newly-revealed notes on later flushes (replacement = implicit close)", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.report("a", 0, true);
    w.flush(); // batch 1 → [a]
    w.report("b", 1, true);
    w.flush(); // batch 2 → [b] only — filters replaced, prior batch closed
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(2);
    expect(sub.subscribeEngagement).toHaveBeenLastCalledWith(["b"]);
    w.dispose();
  });

  it("does nothing when no notes are visible", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.flush();
    expect(sub.subscribeEngagement).not.toHaveBeenCalled();
  });

  it("debounces multiple reports into a single flush", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub, 300);
    w.report("a", 0, true);
    w.report("b", 1, true);
    expect(sub.subscribeEngagement).not.toHaveBeenCalled(); // timer not fired yet
    jest.advanceTimersByTime(300);
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(1);
    expect(sub.subscribeEngagement).toHaveBeenCalledWith(["a", "b"]);
    w.dispose();
  });

  it("never re-fetches a note scrolled out and back into view", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.report("a", 0, true);
    w.flush(); // fetch a
    w.report("a", 0, false); // scrolled away
    w.flush();
    w.report("a", 0, true); // scrolled back
    w.flush();
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it("dispose unsubscribes and resets fetched state", () => {
    const sub = makeSub();
    const w = new EngagementWindow(sub);
    w.report("a", 0, true);
    w.flush();
    w.dispose();
    expect(sub.unsubscribeEngagement).toHaveBeenCalledTimes(1);
    // State cleared — the same id can be fetched again on a fresh window cycle.
    w.report("a", 0, true);
    w.flush();
    expect(sub.subscribeEngagement).toHaveBeenCalledTimes(2);
  });
});
