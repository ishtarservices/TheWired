import { combineReducers, configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { identitySlice } from "./slices/identitySlice";
import { relaysSlice } from "./slices/relaysSlice";
import { spacesSlice } from "./slices/spacesSlice";
import { eventsSlice } from "./slices/eventsSlice";
import { uiSlice } from "./slices/uiSlice";
import { feedSlice } from "./slices/feedSlice";
import { musicSlice } from "./slices/musicSlice";
import { spaceConfigSlice } from "./slices/spaceConfigSlice";
import { dmSlice } from "./slices/dmSlice";
import { notificationSlice } from "./slices/notificationSlice";
import { friendRequestSlice } from "./slices/friendRequestSlice";
import { voiceSlice } from "./slices/voiceSlice";
import { callSlice } from "./slices/callSlice";
import { listenTogetherSlice } from "./slices/listenTogetherSlice";
import { emojiSlice } from "./slices/emojiSlice";
import { gifSlice } from "./slices/gifSlice";
import { onboardingSlice } from "../features/onboarding/onboardingSlice";
import { listenTogetherMiddleware } from "@/features/listenTogether/listenTogetherMiddleware";

const RESET_ALL = "store/RESET_ALL";

export const resetAll = () => ({ type: RESET_ALL });

const appReducer = combineReducers({
  identity: identitySlice.reducer,
  relays: relaysSlice.reducer,
  spaces: spacesSlice.reducer,
  events: eventsSlice.reducer,
  ui: uiSlice.reducer,
  feed: feedSlice.reducer,
  music: musicSlice.reducer,
  spaceConfig: spaceConfigSlice.reducer,
  dm: dmSlice.reducer,
  notifications: notificationSlice.reducer,
  friendRequests: friendRequestSlice.reducer,
  voice: voiceSlice.reducer,
  call: callSlice.reducer,
  listenTogether: listenTogetherSlice.reducer,
  emoji: emojiSlice.reducer,
  gif: gifSlice.reducer,
  onboarding: onboardingSlice.reducer,
});

function rootReducer(state: ReturnType<typeof appReducer> | undefined, action: UnknownAction) {
  if (action.type === RESET_ALL) {
    const fresh = appReducer(undefined, action);
    // Preserve switchingAccount through reset so AuthGate keeps showing the
    // loading screen instead of briefly flashing LoginScreen.
    if (state?.identity.switchingAccount) {
      fresh.identity = { ...fresh.identity, switchingAccount: true };
    }
    return fresh;
  }
  return appReducer(state, action);
}

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(listenTogetherMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
