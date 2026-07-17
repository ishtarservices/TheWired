import { act, renderHook } from "@testing-library/react-native";
import type { NostrEvent } from "@thewired/shared-types";

import {
  BACK_TO_TOP_OFFSET_PX,
  FREEZE_OFFSET_PX,
  countFreshEvents,
  useFeedFreeze,
} from "../feedFreeze";

function note(id: string, pubkey = "p"): NostrEvent {
  return { id, pubkey, created_at: 100, kind: 1, tags: [], content: id, sig: "s" };
}

function scrollEvent(y: number) {
  return { nativeEvent: { contentOffset: { y } } } as never;
}

describe("countFreshEvents", () => {
  it("counts live events not in the frozen snapshot", () => {
    const live = [note("a"), note("b"), note("c")];
    expect(countFreshEvents(live, new Set(["b", "c"]), {})).toBe(1);
  });

  it("excludes muted authors from the count", () => {
    const live = [note("a", "spammer"), note("b"), note("c", "spammer")];
    expect(countFreshEvents(live, new Set(["b"]), { spammer: true })).toBe(0);
  });

  it("is zero when nothing is fresh", () => {
    const live = [note("a")];
    expect(countFreshEvents(live, new Set(["a"]), {})).toBe(0);
  });
});

describe("useFeedFreeze", () => {
  it("starts live (no snapshot) and freezes past the scroll threshold", async () => {
    const live = [note("a")];
    const { result } = await renderHook(() => useFeedFreeze(live));
    expect(result.current.frozen).toBeNull();

    await act(() => {
      result.current.handlers.onScroll(scrollEvent(FREEZE_OFFSET_PX + 1));
    });
    expect(result.current.frozen).toEqual(live);
  });

  it("holds a referentially stable snapshot while live grows", async () => {
    const first = [note("a")];
    const { result, rerender } = await renderHook(
      ({ live }: { live: NostrEvent[] }) => useFeedFreeze(live),
      { initialProps: { live: first } },
    );

    await act(() => {
      result.current.handlers.onScroll(scrollEvent(100));
    });
    const snapshot = result.current.frozen;
    expect(snapshot).toEqual(first);

    await rerender({ live: [note("b"), note("a")] });
    await act(() => {
      result.current.handlers.onScroll(scrollEvent(120));
    });
    expect(result.current.frozen).toBe(snapshot); // capture-once, never regrows
  });

  it("freezes on drag start anywhere below the top", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    await act(() => {
      result.current.handlers.onScrollBeginDrag(scrollEvent(4));
    });
    expect(result.current.frozen).not.toBeNull();
  });

  it("does not freeze on pull-to-refresh drags (y <= 0)", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    await act(() => {
      result.current.handlers.onScrollBeginDrag(scrollEvent(0));
    });
    expect(result.current.frozen).toBeNull();
  });

  it("unfreezes when settling back at the top", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    await act(() => {
      result.current.handlers.onScroll(scrollEvent(200));
    });
    expect(result.current.frozen).not.toBeNull();

    await act(() => {
      result.current.handlers.onMomentumScrollEnd(scrollEvent(0));
    });
    expect(result.current.frozen).toBeNull();
  });

  it("freezeIfScrolled captures the snapshot mid-feed (the blur hook)", async () => {
    const live = [note("a")];
    const { result } = await renderHook(() => useFeedFreeze(live));

    // Scrolled into the feed but currently live (settled without unfreezing).
    await act(() => {
      result.current.handlers.onScroll(scrollEvent(200));
      result.current.unfreeze();
    });
    expect(result.current.frozen).toBeNull();

    await act(() => {
      result.current.freezeIfScrolled();
    });
    expect(result.current.frozen).toEqual(live);
  });

  it("freezeIfScrolled no-ops at the top", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    await act(() => {
      result.current.handlers.onScroll(scrollEvent(FREEZE_OFFSET_PX - 4));
    });
    await act(() => {
      result.current.freezeIfScrolled();
    });
    expect(result.current.frozen).toBeNull();
  });

  it("unfreeze() drops the snapshot directly", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    await act(() => {
      result.current.handlers.onScroll(scrollEvent(200));
    });
    await act(() => {
      result.current.unfreeze();
    });
    expect(result.current.frozen).toBeNull();
  });

  it("tracks scrolledDeep across the back-to-top threshold", async () => {
    const { result } = await renderHook(() => useFeedFreeze([note("a")]));
    expect(result.current.scrolledDeep).toBe(false);

    await act(() => {
      result.current.handlers.onScroll(scrollEvent(BACK_TO_TOP_OFFSET_PX + 1));
    });
    expect(result.current.scrolledDeep).toBe(true);

    await act(() => {
      result.current.handlers.onScroll(scrollEvent(BACK_TO_TOP_OFFSET_PX - 1));
    });
    expect(result.current.scrolledDeep).toBe(false);
  });
});
