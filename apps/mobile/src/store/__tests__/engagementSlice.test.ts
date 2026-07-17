import {
  PER_TARGET_CAP,
  TARGET_CAP,
  engagementReceived,
  engagementSlice,
  removeReactionByEventId,
  selectMyReaction,
  selectMyRepost,
  selectReactionCount,
  selectReplyCount,
  selectRepostCount,
  type EngagementBatch,
} from "../slices/engagementSlice";

const reduce = engagementSlice.reducer;

function batch(partial: Partial<EngagementBatch>): ReturnType<typeof engagementReceived> {
  return engagementReceived({ reactions: [], reposts: [], replies: [], ...partial });
}

describe("engagementSlice", () => {
  it("aggregates reactions and normalizes empty content to '+'", () => {
    const state = reduce(
      undefined,
      batch({
        reactions: [
          { targetEventId: "note", reactor: "alice", content: "", eventId: "r1" },
          { targetEventId: "note", reactor: "bob", content: "🔥", eventId: "r2" },
        ],
      }),
    );
    expect(selectReactionCount({ engagement: state }, "note")).toBe(2);
    expect(selectMyReaction({ engagement: state }, "note", "alice")).toBe("+");
    expect(selectMyReaction({ engagement: state }, "note", "bob")).toBe("🔥");
    expect(selectMyReaction({ engagement: state }, "note", "carol")).toBeUndefined();
  });

  it("dedupes redeliveries by event id", () => {
    const reaction = { targetEventId: "note", reactor: "alice", content: "+", eventId: "r1" };
    let state = reduce(undefined, batch({ reactions: [reaction] }));
    state = reduce(state, batch({ reactions: [reaction] }));
    expect(selectReactionCount({ engagement: state }, "note")).toBe(1);
  });

  it("tracks reposts with the reposter pubkey for the reposted flag", () => {
    const state = reduce(
      undefined,
      batch({ reposts: [{ targetEventId: "note", reposter: "alice", eventId: "rp1" }] }),
    );
    expect(selectRepostCount({ engagement: state }, "note")).toBe(1);
    expect(selectMyRepost({ engagement: state }, "note", "alice")).toBe(true);
    expect(selectMyRepost({ engagement: state }, "note", "bob")).toBe(false);
    expect(selectMyRepost({ engagement: state }, "note", null)).toBe(false);
  });

  it("dedupes replies and saturates at PER_TARGET_CAP", () => {
    let state = reduce(
      undefined,
      batch({
        replies: Array.from({ length: PER_TARGET_CAP + 5 }, (_, i) => ({
          targetEventId: "note",
          eventId: `reply-${i}`,
        })),
      }),
    );
    expect(selectReplyCount({ engagement: state }, "note")).toBe(PER_TARGET_CAP);

    state = reduce(state, batch({ replies: [{ targetEventId: "note", eventId: "reply-0" }] }));
    expect(selectReplyCount({ engagement: state }, "note")).toBe(PER_TARGET_CAP);
  });

  it("removeReactionByEventId requires the original reactor", () => {
    let state = reduce(
      undefined,
      batch({
        reactions: [{ targetEventId: "note", reactor: "alice", content: "+", eventId: "r1" }],
      }),
    );
    state = reduce(state, removeReactionByEventId({ eventId: "r1", byPubkey: "mallory" }));
    expect(selectReactionCount({ engagement: state }, "note")).toBe(1);

    state = reduce(state, removeReactionByEventId({ eventId: "r1", byPubkey: "alice" }));
    expect(selectReactionCount({ engagement: state }, "note")).toBe(0);
    expect(state.reactionsByTarget["note"]).toBeUndefined(); // empty target cleaned
    expect(state.reactionIndex["r1"]).toBeUndefined();
  });

  it("evicts the oldest targets past TARGET_CAP with index cleanup", () => {
    let state = reduce(undefined, batch({}));
    for (let i = 0; i < TARGET_CAP + 1; i++) {
      state = reduce(
        state,
        batch({
          reactions: [
            { targetEventId: `note-${i}`, reactor: "a", content: "+", eventId: `r-${i}` },
          ],
        }),
      );
    }
    // Oldest 100 evicted, newest kept.
    expect(selectReactionCount({ engagement: state }, "note-0")).toBe(0);
    expect(state.reactionIndex["r-0"]).toBeUndefined();
    expect(selectReactionCount({ engagement: state }, `note-${TARGET_CAP}`)).toBe(1);
    expect(state.targetOrder.length).toBeLessThanOrEqual(TARGET_CAP);
  });

  it("selectors are safe on unknown targets", () => {
    const state = reduce(undefined, batch({}));
    expect(selectReactionCount({ engagement: state }, "nope")).toBe(0);
    expect(selectRepostCount({ engagement: state }, "nope")).toBe(0);
    expect(selectReplyCount({ engagement: state }, "nope")).toBe(0);
    expect(selectMyReaction({ engagement: state }, "nope", "me")).toBeUndefined();
  });
});
