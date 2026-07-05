// kind-0 profile metadata by pubkey. Replaceable-event semantics: the
// newest created_at wins, older arrivals are ignored.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { ProfileMetadata } from "@/lib/nostr/profiles";

interface ProfilesState {
  byPubkey: Record<string, ProfileMetadata>;
}

const initialState: ProfilesState = {
  byPubkey: {},
};

function upsert(state: ProfilesState, pubkey: string, profile: ProfileMetadata): void {
  const existing = state.byPubkey[pubkey];
  if (existing && existing.created_at >= profile.created_at) return;
  state.byPubkey[pubkey] = profile;
}

export const profilesSlice = createSlice({
  name: "profiles",
  initialState,
  reducers: {
    profileReceived(
      state,
      action: PayloadAction<{ pubkey: string; profile: ProfileMetadata }>,
    ) {
      upsert(state, action.payload.pubkey, action.payload.profile);
    },
    profilesHydrated(state, action: PayloadAction<Record<string, ProfileMetadata>>) {
      for (const [pubkey, profile] of Object.entries(action.payload)) {
        upsert(state, pubkey, profile);
      }
    },
  },
});

export const { profileReceived, profilesHydrated } = profilesSlice.actions;
