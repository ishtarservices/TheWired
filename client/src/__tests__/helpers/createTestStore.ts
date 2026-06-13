/**
 * Creates a fresh Redux store matching the production configuration,
 * with optional preloaded state for testing.
 */
import { combineReducers, configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { identitySlice } from "@/store/slices/identitySlice";
import { relaysSlice } from "@/store/slices/relaysSlice";
import { spacesSlice } from "@/store/slices/spacesSlice";
import { eventsSlice } from "@/store/slices/eventsSlice";
import { reactionsSlice } from "@/store/slices/reactionsSlice";
import { zapsSlice } from "@/store/slices/zapsSlice";
import { pollsSlice } from "@/store/slices/pollsSlice";
import { uiSlice } from "@/store/slices/uiSlice";
import { feedSlice } from "@/store/slices/feedSlice";
import { musicSlice } from "@/store/slices/musicSlice";
import { spaceConfigSlice } from "@/store/slices/spaceConfigSlice";
import { dmSlice } from "@/store/slices/dmSlice";
import { notificationSlice } from "@/store/slices/notificationSlice";
import { friendRequestSlice } from "@/store/slices/friendRequestSlice";
import { voiceSlice } from "@/store/slices/voiceSlice";
import { callSlice } from "@/store/slices/callSlice";
import { listenTogetherSlice } from "@/store/slices/listenTogetherSlice";
import { emojiSlice } from "@/store/slices/emojiSlice";
import { gifSlice } from "@/store/slices/gifSlice";
import { walletSlice } from "@/store/slices/walletSlice";
import { featuresSlice } from "@/store/slices/featuresSlice";
import { feedPrefsSlice } from "@/store/slices/feedPrefsSlice";
import { aiSlice } from "@/store/slices/aiSlice";
import { onboardingSlice } from "@/features/onboarding/onboardingSlice";
import type { RootState } from "@/store";

const RESET_ALL = "store/RESET_ALL";

const appReducer = combineReducers({
  identity: identitySlice.reducer,
  relays: relaysSlice.reducer,
  spaces: spacesSlice.reducer,
  events: eventsSlice.reducer,
  reactions: reactionsSlice.reducer,
  zaps: zapsSlice.reducer,
  polls: pollsSlice.reducer,
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
  wallet: walletSlice.reducer,
  features: featuresSlice.reducer,
  feedPrefs: feedPrefsSlice.reducer,
  ai: aiSlice.reducer,
  onboarding: onboardingSlice.reducer,
});

function rootReducer(
  state: ReturnType<typeof appReducer> | undefined,
  action: UnknownAction,
) {
  if (action.type === RESET_ALL) {
    const fresh = appReducer(undefined, action);
    if (state?.identity.switchingAccount) {
      fresh.identity = { ...fresh.identity, switchingAccount: true };
    }
    return fresh;
  }
  return appReducer(state, action);
}

export function createTestStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as ReturnType<typeof appReducer>,
  });
}

export type TestStore = ReturnType<typeof createTestStore>;
