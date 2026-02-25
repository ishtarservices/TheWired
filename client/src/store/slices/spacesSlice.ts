import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Space, SpaceChannel } from "../../types/space";

interface SpacesState {
  list: Space[];
  activeSpaceId: string | null;
  activeChannelId: string | null;
  subscriptions: Record<string, string>; // channelId -> subId
  channels: Record<string, SpaceChannel[]>; // spaceId -> channels
  channelsLoading: Record<string, boolean>;
}

const initialState: SpacesState = {
  list: [],
  activeSpaceId: null,
  activeChannelId: null,
  subscriptions: {},
  channels: {},
  channelsLoading: {},
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
      delete state.channels[action.payload];
      delete state.channelsLoading[action.payload];
    },
    updateSpace(state, action: PayloadAction<Space>) {
      const idx = state.list.findIndex((s) => s.id === action.payload.id);
      if (idx >= 0) {
        state.list[idx] = action.payload;
      }
    },
    // Channel management
    setChannels(state, action: PayloadAction<{ spaceId: string; channels: SpaceChannel[] }>) {
      state.channels[action.payload.spaceId] = action.payload.channels;
    },
    addChannelToList(state, action: PayloadAction<SpaceChannel>) {
      const channels = state.channels[action.payload.spaceId];
      if (channels) {
        channels.push(action.payload);
      } else {
        state.channels[action.payload.spaceId] = [action.payload];
      }
    },
    updateChannelInList(state, action: PayloadAction<SpaceChannel>) {
      const channels = state.channels[action.payload.spaceId];
      if (!channels) return;
      const idx = channels.findIndex((c) => c.id === action.payload.id);
      if (idx >= 0) {
        channels[idx] = action.payload;
      }
    },
    removeChannelFromList(state, action: PayloadAction<{ spaceId: string; channelId: string }>) {
      const channels = state.channels[action.payload.spaceId];
      if (!channels) return;
      state.channels[action.payload.spaceId] = channels.filter(
        (c) => c.id !== action.payload.channelId,
      );
    },
    setChannelsLoading(state, action: PayloadAction<{ spaceId: string; loading: boolean }>) {
      state.channelsLoading[action.payload.spaceId] = action.payload.loading;
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
  setChannels,
  addChannelToList,
  updateChannelInList,
  removeChannelFromList,
  setChannelsLoading,
} = spacesSlice.actions;
