import { describe, it, expect } from "vitest";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import {
  addReaction,
  addReactions,
  removeReactionByEventId,
  selectReactionCount,
  selectMyReaction,
  selectReactionAggregate,
  aggregateReactions,
} from "../reactionsSlice";

describe("reactionsSlice", () => {
  it("addReaction records byTarget (keyed by event id) and the byEventId reverse index", () => {
    const store = createTestStore();
    store.dispatch(
      addReaction({ targetEventId: "t1", reactor: "alice", content: "❤️", eventId: "rx1" }),
    );
    const s = store.getState();
    expect(s.reactions.byTarget["t1"]).toEqual({ rx1: { reactor: "alice", content: "❤️" } });
    expect(s.reactions.byEventId["rx1"]).toBe("t1");
  });

  it("empty content defaults to + per NIP-25", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "", eventId: "rx" }));
    expect(selectMyReaction(store.getState(), "t1", "a")).toBe("+");
  });

  it("counts reactions (addReactions batch)", () => {
    const store = createTestStore();
    store.dispatch(
      addReactions([
        { targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" },
        { targetEventId: "t1", reactor: "b", content: "👍", eventId: "r2" },
        { targetEventId: "t1", reactor: "c", content: "🔥", eventId: "r3" },
      ]),
    );
    expect(selectReactionCount(store.getState(), "t1")).toBe(3);
  });

  it("a user may hold multiple distinct reactions (chat multi-emoji)", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "❤️", eventId: "r2" }));
    expect(selectReactionCount(store.getState(), "t1")).toBe(2);
    const agg = selectReactionAggregate(store.getState(), "t1");
    expect(agg).toContainEqual({ content: "👍", count: 1 });
    expect(agg).toContainEqual({ content: "❤️", count: 1 });
  });

  it("re-delivery of the same reaction id is idempotent", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));
    expect(selectReactionCount(store.getState(), "t1")).toBe(1);
  });

  it("aggregates reactions by emoji", () => {
    const store = createTestStore();
    store.dispatch(
      addReactions([
        { targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" },
        { targetEventId: "t1", reactor: "b", content: "👍", eventId: "r2" },
        { targetEventId: "t1", reactor: "c", content: "🔥", eventId: "r3" },
      ]),
    );
    const agg = selectReactionAggregate(store.getState(), "t1");
    expect(agg).toContainEqual({ content: "👍", count: 2 });
    expect(agg).toContainEqual({ content: "🔥", count: 1 });
  });

  it("selectMyReaction returns undefined with no pubkey or no reaction", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));
    expect(selectMyReaction(store.getState(), "t1", null)).toBeUndefined();
    expect(selectMyReaction(store.getState(), "t1", "b")).toBeUndefined();
  });

  it("removeReactionByEventId removes only when the deleter is the original reactor", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));

    // Wrong author — must be ignored (you can't delete someone else's reaction).
    store.dispatch(removeReactionByEventId({ eventId: "r1", byPubkey: "mallory" }));
    expect(selectReactionCount(store.getState(), "t1")).toBe(1);

    // Correct author — removed, and the now-empty target is pruned.
    store.dispatch(removeReactionByEventId({ eventId: "r1", byPubkey: "a" }));
    const s = store.getState();
    expect(selectReactionCount(s, "t1")).toBe(0);
    expect(s.reactions.byTarget["t1"]).toBeUndefined();
    expect(s.reactions.byEventId["r1"]).toBeUndefined();
  });

  it("deleting one of a user's reactions keeps their others", () => {
    const store = createTestStore();
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "👍", eventId: "r1" }));
    store.dispatch(addReaction({ targetEventId: "t1", reactor: "a", content: "❤️", eventId: "r2" }));
    store.dispatch(removeReactionByEventId({ eventId: "r1", byPubkey: "a" }));
    expect(selectReactionCount(store.getState(), "t1")).toBe(1);
    expect(selectMyReaction(store.getState(), "t1", "a")).toBe("❤️");
  });

  it("aggregateReactions handles an undefined map", () => {
    expect(aggregateReactions(undefined)).toEqual([]);
  });
});
