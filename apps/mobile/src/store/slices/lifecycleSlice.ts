// Mobile-only slice fed by the MobileLifecycleController (AppState + NetInfo).
// The relay pool teardown/rebuild logic keys off these transitions once the
// core is wired (guide 06 §2); screens can already read `isOnline` for an
// offline banner.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ForegroundState = "active" | "background";

interface LifecycleState {
  appState: ForegroundState;
  isOnline: boolean;
  /** Epoch ms of the last background→active transition (drives fresh-`since` resubscribes). */
  lastForegroundAt: number | null;
}

const initialState: LifecycleState = {
  appState: "active",
  isOnline: true,
  lastForegroundAt: null,
};

export const lifecycleSlice = createSlice({
  name: "lifecycle",
  initialState,
  reducers: {
    appForegrounded(state, action: PayloadAction<{ at: number }>) {
      state.appState = "active";
      state.lastForegroundAt = action.payload.at;
    },
    appBackgrounded(state) {
      state.appState = "background";
    },
    setOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
  },
});

export const { appForegrounded, appBackgrounded, setOnline } =
  lifecycleSlice.actions;
