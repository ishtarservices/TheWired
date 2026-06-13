import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Kind0Profile } from "../../types/profile";
import type { RelayListEntry } from "../../types/relay";

export type SignerType = "nip07" | "tauri_keystore" | "nip46" | null;

export interface AccountEntry {
  pubkey: string;
  signerType: SignerType;
  addedAt: number;
}

export interface MuteEntry {
  type: "pubkey" | "tag" | "word" | "event";
  value: string;
}

interface IdentityState {
  pubkey: string | null;
  signerType: SignerType;
  profile: Kind0Profile | null;
  /** True once we've resolved the user's current kind:0 (or confirmed none exists
   *  via EOSE). The profile editors gate Save on this so a republish can't clobber
   *  the real profile on relays with a thin form submitted before it loaded. */
  profileChecked: boolean;
  relayList: RelayListEntry[];
  followList: string[];
  knownFollowers: string[];
  muteList: MuteEntry[];
  pinnedNoteIds: string[];
  profileCreatedAt: number;
  followListCreatedAt: number;
  muteListCreatedAt: number;
  pinnedNotesCreatedAt: number;
  relayListCreatedAt: number;
  dmRelayList: string[];
  dmRelayListCreatedAt: number;
  /** All stored accounts (for multi-account switching) */
  accounts: AccountEntry[];
  /** True while switching accounts — prevents flash of login screen */
  switchingAccount: boolean;
}

const initialState: IdentityState = {
  pubkey: null,
  signerType: null,
  profile: null,
  profileChecked: false,
  relayList: [],
  followList: [],
  knownFollowers: [],
  muteList: [],
  pinnedNoteIds: [],
  profileCreatedAt: 0,
  followListCreatedAt: 0,
  muteListCreatedAt: 0,
  pinnedNotesCreatedAt: 0,
  relayListCreatedAt: 0,
  dmRelayList: [],
  dmRelayListCreatedAt: 0,
  accounts: [],
  switchingAccount: false,
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
      // We've now seen a real kind:0 — safe to edit/republish even if a stale
      // (older created_at) duplicate is what arrived.
      state.profileChecked = true;
      if (action.payload.createdAt <= state.profileCreatedAt) return;
      state.profile = action.payload.profile;
      state.profileCreatedAt = action.payload.createdAt;
    },
    /** Mark that we've finished looking for the user's kind:0 (e.g. EOSE with no
     *  profile found — a brand-new user). Lets the editors enable Save. */
    markProfileChecked(state) {
      state.profileChecked = true;
    },
    setRelayList(
      state,
      action: PayloadAction<{ entries: RelayListEntry[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt < state.relayListCreatedAt) return;
      state.relayList = action.payload.entries;
      state.relayListCreatedAt = action.payload.createdAt;
    },
    setDMRelayList(
      state,
      action: PayloadAction<{ relays: string[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt < state.dmRelayListCreatedAt) return;
      state.dmRelayList = action.payload.relays;
      state.dmRelayListCreatedAt = action.payload.createdAt;
    },
    setFollowList(
      state,
      action: PayloadAction<{ follows: string[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt < state.followListCreatedAt) return;
      state.followList = action.payload.follows;
      state.followListCreatedAt = action.payload.createdAt;
    },
    setMuteList(
      state,
      action: PayloadAction<{ mutes: MuteEntry[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt < state.muteListCreatedAt) return;
      state.muteList = action.payload.mutes;
      state.muteListCreatedAt = action.payload.createdAt;
    },
    setPinnedNotes(
      state,
      action: PayloadAction<{ noteIds: string[]; createdAt: number }>,
    ) {
      if (action.payload.createdAt < state.pinnedNotesCreatedAt) return;
      state.pinnedNoteIds = action.payload.noteIds;
      state.pinnedNotesCreatedAt = action.payload.createdAt;
    },
    setKnownFollowers(state, action: PayloadAction<string[]>) {
      state.knownFollowers = action.payload;
    },
    addKnownFollower(state, action: PayloadAction<string>) {
      if (!state.knownFollowers.includes(action.payload)) {
        state.knownFollowers.push(action.payload);
      }
    },
    setAccounts(state, action: PayloadAction<AccountEntry[]>) {
      state.accounts = action.payload;
    },
    setSwitchingAccount(state, action: PayloadAction<boolean>) {
      state.switchingAccount = action.payload;
    },
  },
});

export const {
  login,
  logout,
  setProfile,
  markProfileChecked,
  setRelayList,
  setDMRelayList,
  setFollowList,
  setMuteList,
  setPinnedNotes,
  setKnownFollowers,
  addKnownFollower,
  setAccounts,
  setSwitchingAccount,
} = identitySlice.actions;
