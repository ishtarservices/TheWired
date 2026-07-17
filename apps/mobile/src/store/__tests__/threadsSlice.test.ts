import type { NostrEvent } from "@thewired/shared-types";

import {
  THREAD_EVENTS_CAP,
  THREAD_ROOT_CAP,
  selectRootIdFor,
  selectThreadEntry,
  selectThreadEvents,
  threadEventsMerged,
  threadFetchCompleted,
  threadFetchStarted,
  threadOlderCompleted,
  threadOlderStarted,
  threadsCleared,
  threadsSlice,
} from "../slices/threadsSlice";

type SliceState = ReturnType<typeof threadsSlice.reducer>;

const reduce = (
  state: SliceState | undefined,
  action: Parameters<typeof threadsSlice.reducer>[1],
) => threadsSlice.reducer(state, action);

const wrap = (threads: SliceState) => ({ threads });

const evt = (id: string, createdAt: number, kind = 1): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  created_at: createdAt,
  kind,
  tags: [],
  content: id,
  sig: "f".repeat(128),
});

describe("threadsSlice", () => {
  it("merges chronologically, dedups by id, and indexes aliases", () => {
    let state = reduce(
      undefined,
      threadEventsMerged({ rootId: "root", events: [evt("b", 200), evt("a", 100)] }),
    );
    state = reduce(state, threadEventsMerged({ rootId: "root", events: [evt("a", 100)] }));

    expect(selectThreadEvents(wrap(state), "root").map((e) => e.id)).toEqual(["a", "b"]);
    expect(selectRootIdFor(wrap(state), "a")).toBe("root");
    expect(selectRootIdFor(wrap(state), "b")).toBe("root");
    expect(selectRootIdFor(wrap(state), "nope")).toBeUndefined();
  });

  it("ignores non-kind-1 events", () => {
    const state = reduce(
      undefined,
      threadEventsMerged({ rootId: "root", events: [evt("zap", 100, 9735)] }),
    );
    expect(selectThreadEvents(wrap(state), "root")).toEqual([]);
  });

  it("caps per-root events keeping the newest but never evicting the root", () => {
    const bulk = Array.from({ length: THREAD_EVENTS_CAP + 10 }, (_, i) =>
      evt(`r${String(i).padStart(4, "0")}`, 1000 + i),
    );
    let state = reduce(
      undefined,
      threadEventsMerged({ rootId: "root", events: [evt("root", 1)] }),
    );
    state = reduce(state, threadEventsMerged({ rootId: "root", events: bulk }));

    const events = selectThreadEvents(wrap(state), "root");
    expect(events).toHaveLength(THREAD_EVENTS_CAP);
    expect(events[0]?.id).toBe("root"); // oldest event, still present
    expect(events[events.length - 1]?.id).toBe("r0309"); // newest kept
    expect(events.some((e) => e.id === "r0000")).toBe(false); // oldest reply dropped
  });

  it("LRU-evicts whole roots (and their aliases) beyond THREAD_ROOT_CAP", () => {
    let state: SliceState | undefined;
    for (let i = 0; i < THREAD_ROOT_CAP + 1; i++) {
      state = reduce(
        state,
        threadEventsMerged({ rootId: `root${i}`, events: [evt(`e${i}`, 100 + i)] }),
      );
    }
    expect(selectThreadEntry(wrap(state!), "root0")).toBeUndefined();
    expect(selectRootIdFor(wrap(state!), "e0")).toBeUndefined();
    expect(selectThreadEntry(wrap(state!), `root${THREAD_ROOT_CAP}`)).toBeDefined();
  });

  it("touching a root protects it from LRU eviction", () => {
    let state = reduce(
      undefined,
      threadEventsMerged({ rootId: "keep", events: [evt("k", 100)] }),
    );
    for (let i = 0; i < THREAD_ROOT_CAP - 1; i++) {
      state = reduce(
        state,
        threadEventsMerged({ rootId: `root${i}`, events: [evt(`e${i}`, 100 + i)] }),
      );
    }
    // Re-touch "keep", then push one more root over the cap: the LRU victim
    // must be root0, not keep.
    state = reduce(state, threadFetchStarted({ rootId: "keep" }));
    state = reduce(state, threadEventsMerged({ rootId: "extra", events: [evt("x", 999)] }));

    expect(selectThreadEntry(wrap(state), "keep")).toBeDefined();
    expect(selectThreadEntry(wrap(state), "root0")).toBeUndefined();
  });

  it("tracks fetch lifecycle: loading cold, refreshing warm, ready on complete", () => {
    let state = reduce(undefined, threadFetchStarted({ rootId: "root" }));
    expect(selectThreadEntry(wrap(state), "root")?.status).toBe("loading");

    state = reduce(state, threadEventsMerged({ rootId: "root", events: [evt("a", 100)] }));
    state = reduce(
      state,
      threadFetchCompleted({ rootId: "root", fetchedAt: 500, truncated: true, oldestReplyAt: 100 }),
    );
    const entry = selectThreadEntry(wrap(state), "root");
    expect(entry?.status).toBe("ready");
    expect(entry?.fetchedAt).toBe(500);
    expect(entry?.truncated).toBe(true);
    expect(entry?.oldestReplyAt).toBe(100);

    state = reduce(state, threadFetchStarted({ rootId: "root" }));
    expect(selectThreadEntry(wrap(state), "root")?.status).toBe("refreshing");
  });

  it("load-older lifecycle clears truncated when exhausted", () => {
    let state = reduce(undefined, threadFetchStarted({ rootId: "root" }));
    state = reduce(
      state,
      threadFetchCompleted({ rootId: "root", fetchedAt: 1, truncated: true, oldestReplyAt: 100 }),
    );
    state = reduce(state, threadOlderStarted({ rootId: "root" }));
    expect(selectThreadEntry(wrap(state), "root")?.loadingOlder).toBe(true);

    state = reduce(
      state,
      threadOlderCompleted({ rootId: "root", oldestReplyAt: 50, exhausted: true }),
    );
    const entry = selectThreadEntry(wrap(state), "root");
    expect(entry?.loadingOlder).toBe(false);
    expect(entry?.oldestReplyAt).toBe(50);
    expect(entry?.truncated).toBe(false);
  });

  it("threadsCleared resets everything", () => {
    let state = reduce(
      undefined,
      threadEventsMerged({ rootId: "root", events: [evt("a", 100)] }),
    );
    state = reduce(state, threadsCleared());
    expect(selectThreadEntry(wrap(state), "root")).toBeUndefined();
    expect(selectRootIdFor(wrap(state), "a")).toBeUndefined();
  });
});
