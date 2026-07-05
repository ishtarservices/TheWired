// Local moderation state (App Store 1.2): blocked users' content must
// actually disappear. Blocks are device-local for now — the desktop's
// kind-10000 mute-list sync arrives with the shared core; reports queue
// locally until the reporting backend/kind-1984 path lands.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface ModerationState {
  /** pubkey → true. Content from these authors is hidden everywhere. */
  mutedPubkeys: Record<string, true>;
  /** event ids the user reported (stub queue — informs UI state). */
  reportedEventIds: Record<string, true>;
}

const initialState: ModerationState = {
  mutedPubkeys: {},
  reportedEventIds: {},
};

export const moderationSlice = createSlice({
  name: "moderation",
  initialState,
  reducers: {
    userMuted(state, action: PayloadAction<string>) {
      state.mutedPubkeys[action.payload] = true;
    },
    userUnmuted(state, action: PayloadAction<string>) {
      delete state.mutedPubkeys[action.payload];
    },
    eventReported(state, action: PayloadAction<string>) {
      state.reportedEventIds[action.payload] = true;
    },
    moderationHydrated(
      state,
      action: PayloadAction<{ mutedPubkeys: string[]; reportedEventIds: string[] }>,
    ) {
      for (const pubkey of action.payload.mutedPubkeys) {
        state.mutedPubkeys[pubkey] = true;
      }
      for (const id of action.payload.reportedEventIds) {
        state.reportedEventIds[id] = true;
      }
    },
  },
});

export const { userMuted, userUnmuted, eventReported, moderationHydrated } =
  moderationSlice.actions;
