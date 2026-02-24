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
}

const initialState: IdentityState = {
  pubkey: null,
  signerType: null,
  profile: null,
  relayList: [],
  followList: [],
  muteList: [],
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
    setProfile(state, action: PayloadAction<Kind0Profile>) {
      state.profile = action.payload;
    },
    setRelayList(state, action: PayloadAction<RelayListEntry[]>) {
      state.relayList = action.payload;
    },
    setFollowList(state, action: PayloadAction<string[]>) {
      state.followList = action.payload;
    },
    setMuteList(state, action: PayloadAction<MuteEntry[]>) {
      state.muteList = action.payload;
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
