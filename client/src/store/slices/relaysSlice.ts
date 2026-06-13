import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RelayInfo, RelayStatus } from "../../types/relay";

interface RelaysState {
  connections: Record<string, RelayInfo>;
  /** Locally-disabled relays (normalized URLs). Local-only: these stay in the
   *  user's published NIP-65 list but are never auto-connected on this device.
   *  Persisted per-account in IndexedDB ("relay_disabled" user-state key). */
  disabledRelays: string[];
}

const initialState: RelaysState = {
  connections: {},
  disabledRelays: [],
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
    setDisabledRelays(state, action: PayloadAction<string[]>) {
      state.disabledRelays = action.payload;
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
    /** Batched variant of incrementEventCount: url -> delta (eventPipeline flush) */
    incrementCounts(state, action: PayloadAction<Record<string, number>>) {
      for (const [url, n] of Object.entries(action.payload)) {
        if (state.connections[url]) {
          state.connections[url].eventCount += n;
        }
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
  setDisabledRelays,
  updateLatency,
  incrementEventCount,
  incrementCounts,
  setRelayError,
} = relaysSlice.actions;
