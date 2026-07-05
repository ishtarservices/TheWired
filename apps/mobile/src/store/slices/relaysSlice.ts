// Stub — receives the ported desktop relaysSlice at Phase 0.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type RelayStatus = "connecting" | "connected" | "disconnected" | "error";

interface RelaysState {
  /** Connection status per relay URL. */
  statuses: Record<string, RelayStatus>;
}

const initialState: RelaysState = {
  statuses: {},
};

export const relaysSlice = createSlice({
  name: "relays",
  initialState,
  reducers: {
    setRelayStatus(
      state,
      action: PayloadAction<{ url: string; status: RelayStatus }>,
    ) {
      state.statuses[action.payload.url] = action.payload.status;
    },
    removeRelay(state, action: PayloadAction<string>) {
      delete state.statuses[action.payload];
    },
  },
});

export const { setRelayStatus, removeRelay } = relaysSlice.actions;
