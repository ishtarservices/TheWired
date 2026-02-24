import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Space } from "../../types/space";

interface SpacesState {
  list: Space[];
  activeSpaceId: string | null;
  activeChannelId: string | null;
  subscriptions: Record<string, string>; // channelId -> subId
}

const initialState: SpacesState = {
  list: [],
  activeSpaceId: null,
  activeChannelId: null,
  subscriptions: {},
};

export const spacesSlice = createSlice({
  name: "spaces",
  initialState,
  reducers: {
    setSpaces(state, action: PayloadAction<Space[]>) {
      state.list = action.payload;
    },
    addSpace(state, action: PayloadAction<Space>) {
      const idx = state.list.findIndex((s) => s.id === action.payload.id);
      if (idx >= 0) {
        state.list[idx] = action.payload;
      } else {
        state.list.push(action.payload);
      }
    },
    setActiveSpace(state, action: PayloadAction<string | null>) {
      state.activeSpaceId = action.payload;
    },
    setActiveChannel(state, action: PayloadAction<string | null>) {
      state.activeChannelId = action.payload;
    },
    setChannelSubscription(
      state,
      action: PayloadAction<{ channelId: string; subId: string }>,
    ) {
      state.subscriptions[action.payload.channelId] = action.payload.subId;
    },
    removeChannelSubscription(state, action: PayloadAction<string>) {
      delete state.subscriptions[action.payload];
    },
    updateSpaceMembers(
      state,
      action: PayloadAction<{ spaceId: string; members: string[] }>,
    ) {
      const space = state.list.find((s) => s.id === action.payload.spaceId);
      if (space) {
        space.memberPubkeys = action.payload.members;
      }
    },
    removeSpace(state, action: PayloadAction<string>) {
      state.list = state.list.filter((s) => s.id !== action.payload);
      if (state.activeSpaceId === action.payload) {
        state.activeSpaceId = null;
        state.activeChannelId = null;
      }
    },
    updateSpace(state, action: PayloadAction<Space>) {
      const idx = state.list.findIndex((s) => s.id === action.payload.id);
      if (idx >= 0) {
        state.list[idx] = action.payload;
      }
    },
  },
});

export const {
  setSpaces,
  addSpace,
  setActiveSpace,
  setActiveChannel,
  setChannelSubscription,
  removeChannelSubscription,
  updateSpaceMembers,
  removeSpace,
  updateSpace,
} = spacesSlice.actions;
