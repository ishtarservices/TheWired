import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Space, SpaceChannel } from "../../types/space";
import { spaceLocalKey } from "../../features/spaces/spaceType";

export interface PendingInvite {
  code: string;
  spaceId: string;
  inviterPubkey?: string;
  timestamp: number;
}

interface SpacesState {
  list: Space[];
  activeSpaceId: string | null;
  activeChannelId: string | null;
  subscriptions: Record<string, string>; // channelId -> subId
  channels: Record<string, SpaceChannel[]>; // spaceId -> channels
  channelsLoading: Record<string, boolean>;
  pendingInvites: PendingInvite[];
}

const initialState: SpacesState = {
  list: [],
  activeSpaceId: null,
  activeChannelId: null,
  subscriptions: {},
  channels: {},
  channelsLoading: {},
  pendingInvites: [],
};

export const spacesSlice = createSlice({
  name: "spaces",
  initialState,
  reducers: {
    setSpaces(state, action: PayloadAction<Space[]>) {
      state.list = action.payload;
    },
    addSpace(state, action: PayloadAction<Space>) {
      const incoming = action.payload;
      const idx = state.list.findIndex((s) => s.id === incoming.id);
      if (idx >= 0) {
        // #42 — `space.id` is the NIP-29 group id; two unrelated native groups on
        // different hosts can share one id. Only replace when the full local key
        // (host'groupId for native, id otherwise) matches — otherwise an import
        // would silently overwrite (hijack) an existing, different space.
        if (spaceLocalKey(state.list[idx]) === spaceLocalKey(incoming)) {
          state.list[idx] = incoming;
        } else {
          console.warn(
            `[spaces] refusing to overwrite space ${incoming.id}: local key mismatch`,
          );
        }
      } else {
        state.list.push(incoming);
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
    addPendingInvite(state, action: PayloadAction<PendingInvite>) {
      if (!state.pendingInvites.some((i) => i.code === action.payload.code)) {
        state.pendingInvites.push(action.payload);
      }
    },
    removePendingInvite(state, action: PayloadAction<string>) {
      state.pendingInvites = state.pendingInvites.filter((i) => i.code !== action.payload);
    },
    clearSpacePendingInvites(state, action: PayloadAction<string>) {
      state.pendingInvites = state.pendingInvites.filter((i) => i.spaceId !== action.payload);
    },
    updateSpaceFeedSources(
      state,
      action: PayloadAction<{ spaceId: string; pubkeys: string[] }>,
    ) {
      const space = state.list.find((s) => s.id === action.payload.spaceId);
      if (space) {
        space.feedPubkeys = action.payload.pubkeys;
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
  setChannels,
  addChannelToList,
  updateChannelInList,
  removeChannelFromList,
  setChannelsLoading,
  addPendingInvite,
  removePendingInvite,
  clearSpacePendingInvites,
  updateSpaceFeedSources,
} = spacesSlice.actions;
