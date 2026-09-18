import { describe, it, expect } from "vitest";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import {
  addReaction,
  addReactions,
  removeReactionByEventId,
  selectReactionCount,
  selectMyReaction,
  selectReactionAggregate,
  selectMyReactionEventIds,
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
    expect(agg).toContainEqual({ content: "👍", count: 1, mine: false });
    expect(agg).toContainEqual({ content: "❤️", count: 1, mine: false });
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
    expect(agg).toContainEqual({ content: "👍", count: 2, mine: false });
    expect(agg).toContainEqual({ content: "🔥", count: 1, mine: false });
  });

  it("aggregateReactions flags the pills the given user reacted with (multi-user data)", () => {
    const store = createTestStore();
    store.dispatch(
      addReactions([
        { targetEventId: "t1", reactor: "me", content: "👍", eventId: "r1" },
        { targetEventId: "t1", reactor: "b", content: "👍", eventId: "r2" },
        { targetEventId: "t1", reactor: "c", content: "🔥", eventId: "r3" },
      ]),
    );
    const agg = selectReactionAggregate(store.getState(), "t1", "me");
    expect(agg).toContainEqual({ content: "👍", count: 2, mine: true });
    expect(agg).toContainEqual({ content: "🔥", count: 1, mine: false });
    // No pubkey → nothing is "mine".
    expect(selectReactionAggregate(store.getState(), "t1", null).every((p) => !p.mine)).toBe(true);
  });

  it("selectMyReactionEventIds returns own reaction ids, optionally narrowed to one emoji", () => {
    const store = createTestStore();
    store.dispatch(
      addReactions([
        { targetEventId: "t1", reactor: "me", content: "👍", eventId: "r1" },
        { targetEventId: "t1", reactor: "me", content: "🔥", eventId: "r2" },
        { targetEventId: "t1", reactor: "me", content: "", eventId: "r3" },
        { targetEventId: "t1", reactor: "b", content: "👍", eventId: "r4" },
      ]),
    );
    const s = store.getState();
    expect(selectMyReactionEventIds(s, "t1", "me").sort()).toEqual(["r1", "r2", "r3"]);
    expect(selectMyReactionEventIds(s, "t1", "me", "👍")).toEqual(["r1"]);
    // "" normalizes to "+" on both sides.
    expect(selectMyReactionEventIds(s, "t1", "me", "")).toEqual(["r3"]);
    expect(selectMyReactionEventIds(s, "t1", "me", "+")).toEqual(["r3"]);
    expect(selectMyReactionEventIds(s, "t1", "me", "❤️")).toEqual([]);
    expect(selectMyReactionEventIds(s, "t1", null)).toEqual([]);
    expect(selectMyReactionEventIds(s, "nope", "me")).toEqual([]);
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
