import {
  eventReported,
  moderationHydrated,
  moderationSlice,
  userMuted,
  userUnmuted,
} from "../slices/moderationSlice";

const reduce = moderationSlice.reducer;

describe("moderationSlice", () => {
  it("mutes and unmutes users", () => {
    let state = reduce(undefined, userMuted("pk1"));
    expect(state.mutedPubkeys.pk1).toBe(true);

    state = reduce(state, userUnmuted("pk1"));
    expect(state.mutedPubkeys.pk1).toBeUndefined();
  });

  it("tracks reported events", () => {
    const state = reduce(undefined, eventReported("e1"));
    expect(state.reportedEventIds.e1).toBe(true);
  });

  it("hydrates persisted state additively", () => {
    let state = reduce(undefined, userMuted("live"));
    state = reduce(
      state,
      moderationHydrated({ mutedPubkeys: ["cached"], reportedEventIds: ["r1"] }),
    );
    expect(state.mutedPubkeys).toEqual({ live: true, cached: true });
    expect(state.reportedEventIds).toEqual({ r1: true });
  });
});
