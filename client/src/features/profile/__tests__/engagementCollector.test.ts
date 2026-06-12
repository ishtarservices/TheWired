import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/nostr/subscriptionManager", () => ({
  subscriptionManager: { subscribe: vi.fn(), close: vi.fn() },
}));

import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { EngagementWindow } from "../engagementCollector";

const subscribe = vi.mocked(subscriptionManager.subscribe);
const close = vi.mocked(subscriptionManager.close);

/** The #e list shared by all three filters of a given subscribe() call. */
function eIds(callIndex: number): string[] {
  return (subscribe.mock.calls[callIndex][0] as {
    filters: { "#e": string[] }[];
  }).filters[0]["#e"];
}

beforeEach(() => {
  vi.useFakeTimers();
  subscribe.mockReset();
  close.mockReset();
  let n = 0;
  subscribe.mockImplementation(() => `sub-${++n}`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EngagementWindow", () => {
  it("fetches engagement for visible notes in document order, kinds [7,6,1,9735]", () => {
    const w = new EngagementWindow(["wss://r"]);
    w.report("b", 1, true);
    w.report("a", 0, true);
    w.flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(eIds(0)).toEqual(["a", "b"]); // sorted by feed index
    const filters = (subscribe.mock.calls[0][0] as { filters: { kinds: number[] }[] }).filters;
    expect(filters.map((f) => f.kinds)).toEqual([[7], [6], [1], [9735]]);
    w.dispose();
  });

  it("fetches each note only once when the visible set is unchanged", () => {
    const w = new EngagementWindow();
    w.report("a", 0, true);
    w.flush();
    w.report("a", 0, true); // still visible, already fetched
    w.flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it("fetches only newly-revealed notes and closes the prior batch's sub", () => {
    const w = new EngagementWindow();
    w.report("a", 0, true);
    w.flush(); // sub-1 → [a]
    w.report("b", 1, true);
    w.flush(); // sub-2 → [b], closes sub-1
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(eIds(1)).toEqual(["b"]);
    expect(close).toHaveBeenCalledWith("sub-1");
    w.dispose();
  });

  it("does nothing when no notes are visible", () => {
    const w = new EngagementWindow();
    w.flush();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("debounces multiple reports into a single flush", () => {
    const w = new EngagementWindow(undefined, 300);
    w.report("a", 0, true);
    w.report("b", 1, true);
    expect(subscribe).not.toHaveBeenCalled(); // timer not fired yet
    vi.advanceTimersByTime(300);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(eIds(0)).toEqual(["a", "b"]);
    w.dispose();
  });

  it("never re-fetches a note scrolled out and back into view", () => {
    const w = new EngagementWindow();
    w.report("a", 0, true);
    w.flush(); // fetch a
    w.report("a", 0, false); // scrolled away
    w.flush();
    w.report("a", 0, true); // scrolled back
    w.flush();
    expect(subscribe).toHaveBeenCalledTimes(1);
    w.dispose();
  });

  it("dispose closes the open sub and resets fetched state", () => {
    const w = new EngagementWindow();
    w.report("a", 0, true);
    w.flush();
    w.dispose();
    expect(close).toHaveBeenCalledWith("sub-1");
    // State cleared — the same id can be fetched again on a fresh window cycle.
    w.report("a", 0, true);
    w.flush();
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
