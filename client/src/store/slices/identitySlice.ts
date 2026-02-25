import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Kind0Profile } from "../../types/profile";
import type { RelayListEntry } from "../../types/relay";

export type SignerType = "nip07" | "tauri_keystore" | null;

interface MuteEntry {
  type: "pubkey" | "tag" | "word" | "event";
  value: string;
}

interface IdentityState {
  pubkey: string | null;
  signerType: SignerType;
  profile: Kind0Profile | null;
  relayList: RelayListEntry[];
  followList: string[];
  muteList: MuteEntry[];
  profileCreatedAt: number;
  followListCreatedAt: number;
  muteListCreatedAt: number;
  relayListCreatedAt: number;
}

const initialState: IdentityState = {
  pubkey: null,
  signerType: null,
  profile: null,
  relayList: [],
  followList: [],
  muteList: [],
  profileCreatedAt: 0,
  followListCreatedAt: 0,
  muteListCreatedAt: 0,
  relayListCreatedAt: 0,
};

export const identitySlice = createSlice({
  name: "identity",
  initialState,
  reducers: {
    login(
      state,
      action: PayloadAction<{ pubkey: string; signerType: SignerType }>,
    ) {
      state.pubkey = action.payload.pubkey;
      state.signerType = action.payload.signerType;
    },
    logout(state) {
      Object.assign(state, initialState);
    },
    setProfile(
      state,
      action: PayloadAction<{ profile: Kind0Profile; createdAt: number }>,
    ) {
      if (action.payload.createdAt <= state.profileCreatedAt) return;
      state.profile = action.payload.profile;
      state.profileCreatedAt = action.payload.createdAt;
    },
    setRelayList(
      state,
      action: PayloadAction<{ entries: RelayListEntry[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt <= state.relayListCreatedAt) return;
      state.relayList = action.payload.entries;
      state.relayListCreatedAt = action.payload.createdAt;
    },
    setFollowList(
      state,
      action: PayloadAction<{ follows: string[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt <= state.followListCreatedAt) return;
      state.followList = action.payload.follows;
      state.followListCreatedAt = action.payload.createdAt;
    },
    setMuteList(
      state,
      action: PayloadAction<{ mutes: MuteEntry[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt <= state.muteListCreatedAt) return;
      state.muteList = action.payload.mutes;
      state.muteListCreatedAt = action.payload.createdAt;
    },
  },
});

export const {
  login,
  logout,
  setProfile,
  setRelayList,
  setFollowList,
  setMuteList,
} = identitySlice.actions;
