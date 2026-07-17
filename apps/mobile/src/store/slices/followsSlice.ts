// The signed-in user's follow list (kind 3), read-only in this pass — no
// publish path. Hydrated by the engine on start/identity change; the follows
// feed context filters authors against these pubkeys.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type FollowsStatus = "idle" | "loading" | "ready" | "missing";

interface FollowsState {
  /** Followed pubkeys, p-tag order preserved, deduped. */
  pubkeys: string[];
  /** created_at of the parsed kind-3 (0 = none yet) — stale relays lose. */
  listCreatedAt: number;
  /** Wall-clock unix seconds of the last fetch attempt. */
  fetchedAt: number;
  status: FollowsStatus;
}

const initialState: FollowsState = {
  pubkeys: [],
  listCreatedAt: 0,
  fetchedAt: 0,
  status: "idle",
};

export const followsSlice = createSlice({
  name: "follows",
  initialState,
  reducers: {
    followsLoading(state) {
      state.status = "loading";
    },
    followsReceived(
      state,
      action: PayloadAction<{ pubkeys: string[]; listCreatedAt: number; fetchedAt: number }>,
    ) {
      // Replaceable event: an older list from a lagging relay never wins.
      if (action.payload.listCreatedAt < state.listCreatedAt) return;
      state.pubkeys = action.payload.pubkeys;
      state.listCreatedAt = action.payload.listCreatedAt;
      state.fetchedAt = action.payload.fetchedAt;
      state.status = "ready";
    },
    /** Relays returned no kind-3 at all — distinct from an empty follow list. */
    followsMissing(state, action: PayloadAction<{ fetchedAt: number }>) {
      state.pubkeys = [];
      state.fetchedAt = action.payload.fetchedAt;
      state.status = "missing";
    },
    /** Logout / account switch. */
    followsCleared() {
      return initialState;
    },
  },
});

export const { followsLoading, followsReceived, followsMissing, followsCleared } =
  followsSlice.actions;
