import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RelayInfo, RelayStatus } from "../../types/relay";

interface RelaysState {
  connections: Record<string, RelayInfo>;
}

const initialState: RelaysState = {
  connections: {},
};

export const relaysSlice = createSlice({
  name: "relays",
  initialState,
  reducers: {
    setRelayStatus(
      state,
      action: PayloadAction<{ url: string; status: RelayStatus }>,
    ) {
      const { url, status } = action.payload;
      if (state.connections[url]) {
        state.connections[url].status = status;
        if (status === "connected") {
          state.connections[url].lastConnected = Date.now();
        }
      }
    },
    addRelay(state, action: PayloadAction<RelayInfo>) {
      state.connections[action.payload.url] = action.payload;
    },
    removeRelay(state, action: PayloadAction<string>) {
      delete state.connections[action.payload];
    },
    updateLatency(
      state,
      action: PayloadAction<{ url: string; latencyMs: number }>,
    ) {
      if (state.connections[action.payload.url]) {
        state.connections[action.payload.url].latencyMs =
          action.payload.latencyMs;
      }
    },
    incrementEventCount(state, action: PayloadAction<string>) {
      if (state.connections[action.payload]) {
        state.connections[action.payload].eventCount++;
      }
    },
    setRelayError(
      state,
      action: PayloadAction<{ url: string; error: string }>,
    ) {
      if (state.connections[action.payload.url]) {
        state.connections[action.payload.url].error = action.payload.error;
        state.connections[action.payload.url].status = "error";
      }
    },
  },
});

export const {
  setRelayStatus,
  addRelay,
  removeRelay,
  updateLatency,
  incrementEventCount,
  setRelayError,
} = relaysSlice.actions;
