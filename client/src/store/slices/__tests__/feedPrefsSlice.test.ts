import { describe, it, expect } from "vitest";
import {
  feedPrefsSlice,
  setFeedPrefs,
  setShowReplies,
  setShowReposts,
  hideAccount,
  unhideAccount,
  selectHiddenPubkeySet,
  type FeedPrefs,
} from "../feedPrefsSlice";
import type { RootState } from "../../index";

const reducer = feedPrefsSlice.reducer;
const initial = reducer(undefined, { type: "@@INIT" });

describe("feedPrefsSlice", () => {
  it("defaults to replies/reposts off and no hidden accounts", () => {
    expect(initial).toEqual({
      showReplies: false,
      showReposts: false,
      hiddenPubkeys: [],
    });
  });

  it("setFeedPrefs replaces the whole state (hydration)", () => {
    const hydrated: FeedPrefs = {
      showReplies: true,
      showReposts: true,
      hiddenPubkeys: ["pk-1"],
    };
    expect(reducer(initial, setFeedPrefs(hydrated))).toEqual(hydrated);
  });

  it("toggles showReplies and showReposts independently", () => {
    let state = reducer(initial, setShowReplies(true));
    expect(state.showReplies).toBe(true);
    expect(state.showReposts).toBe(false);
    state = reducer(state, setShowReposts(true));
    expect(state.showReposts).toBe(true);
    state = reducer(state, setShowReplies(false));
    expect(state).toEqual({
      showReplies: false,
      showReposts: true,
      hiddenPubkeys: [],
    });
  });

  it("hideAccount adds a pubkey once (idempotent)", () => {
    let state = reducer(initial, hideAccount("pk-1"));
    state = reducer(state, hideAccount("pk-1"));
    state = reducer(state, hideAccount("pk-2"));
    expect(state.hiddenPubkeys).toEqual(["pk-1", "pk-2"]);
  });

  it("unhideAccount removes only the given pubkey", () => {
    let state = reducer(initial, hideAccount("pk-1"));
    state = reducer(state, hideAccount("pk-2"));
    state = reducer(state, unhideAccount("pk-1"));
    expect(state.hiddenPubkeys).toEqual(["pk-2"]);
  });

  it("selectHiddenPubkeySet memoizes on the hiddenPubkeys array reference", () => {
    const prefs = reducer(initial, hideAccount("pk-1"));
    const state = { feedPrefs: prefs } as unknown as RootState;
    const s1 = selectHiddenPubkeySet(state);
    const s2 = selectHiddenPubkeySet({ feedPrefs: prefs } as unknown as RootState);
    expect(s2).toBe(s1); // same input array → same Set instance
    expect(s1.has("pk-1")).toBe(true);
  });
});
