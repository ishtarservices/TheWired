import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../index";

/**
 * Per-account preferences for the Feed (the follow-list virtual space).
 * Persisted via `userStateStore` ("feed_prefs") — see feedPrefsPersistence.ts.
 * `hiddenPubkeys` is a local-only hide list: accounts hidden from the Feed on
 * this device without publishing anything (unlike the NIP-51 mute list).
 */

export interface FeedPrefs {
  showReplies: boolean;
  showReposts: boolean;
  hiddenPubkeys: string[];
}

const initialState: FeedPrefs = {
  showReplies: false,
  showReposts: false,
  hiddenPubkeys: [],
};

export const feedPrefsSlice = createSlice({
  name: "feedPrefs",
  initialState,
  reducers: {
    /** Replace the whole prefs object (hydration from IndexedDB at login). */
    setFeedPrefs(_state, action: PayloadAction<FeedPrefs>) {
      return action.payload;
    },
    setShowReplies(state, action: PayloadAction<boolean>) {
      state.showReplies = action.payload;
    },
    setShowReposts(state, action: PayloadAction<boolean>) {
      state.showReposts = action.payload;
    },
    hideAccount(state, action: PayloadAction<string>) {
      if (!state.hiddenPubkeys.includes(action.payload)) {
        state.hiddenPubkeys.push(action.payload);
      }
    },
    unhideAccount(state, action: PayloadAction<string>) {
      state.hiddenPubkeys = state.hiddenPubkeys.filter(
        (p) => p !== action.payload,
      );
    },
  },
});

export const {
  setFeedPrefs,
  setShowReplies,
  setShowReposts,
  hideAccount,
  unhideAccount,
} = feedPrefsSlice.actions;

export const selectShowReplies = (state: RootState) =>
  state.feedPrefs.showReplies;
export const selectShowReposts = (state: RootState) =>
  state.feedPrefs.showReposts;
export const selectHiddenPubkeys = (state: RootState) =>
  state.feedPrefs.hiddenPubkeys;

/** Memoized Set of locally hidden pubkeys (stable until the list changes). */
export const selectHiddenPubkeySet = createSelector(
  [selectHiddenPubkeys],
  (pubkeys) => new Set(pubkeys),
);
