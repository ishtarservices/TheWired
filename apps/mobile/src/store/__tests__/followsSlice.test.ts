import {
  followsCleared,
  followsLoading,
  followsMissing,
  followsReceived,
  followsSlice,
} from "../slices/followsSlice";

const reduce = followsSlice.reducer;

describe("followsSlice", () => {
  it("moves idle → loading → ready with the parsed list", () => {
    let state = reduce(undefined, followsLoading());
    expect(state.status).toBe("loading");

    state = reduce(
      state,
      followsReceived({ pubkeys: ["a".repeat(64)], listCreatedAt: 100, fetchedAt: 500 }),
    );
    expect(state.status).toBe("ready");
    expect(state.pubkeys).toEqual(["a".repeat(64)]);
    expect(state.listCreatedAt).toBe(100);
    expect(state.fetchedAt).toBe(500);
  });

  it("ignores a stale list from a lagging relay", () => {
    let state = reduce(
      undefined,
      followsReceived({ pubkeys: ["a".repeat(64)], listCreatedAt: 200, fetchedAt: 500 }),
    );
    state = reduce(
      state,
      followsReceived({ pubkeys: ["b".repeat(64)], listCreatedAt: 100, fetchedAt: 600 }),
    );
    expect(state.pubkeys).toEqual(["a".repeat(64)]);
    expect(state.listCreatedAt).toBe(200);
  });

  it("missing is distinct from ready-empty", () => {
    const missing = reduce(undefined, followsMissing({ fetchedAt: 500 }));
    expect(missing.status).toBe("missing");
    expect(missing.pubkeys).toEqual([]);

    const readyEmpty = reduce(
      undefined,
      followsReceived({ pubkeys: [], listCreatedAt: 100, fetchedAt: 500 }),
    );
    expect(readyEmpty.status).toBe("ready");
    expect(readyEmpty.pubkeys).toEqual([]);
  });

  it("clear resets to initial state", () => {
    let state = reduce(
      undefined,
      followsReceived({ pubkeys: ["a".repeat(64)], listCreatedAt: 100, fetchedAt: 500 }),
    );
    state = reduce(state, followsCleared());
    expect(state.status).toBe("idle");
    expect(state.pubkeys).toEqual([]);
    expect(state.listCreatedAt).toBe(0);
  });
});
