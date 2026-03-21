import { configureStore } from "@reduxjs/toolkit";
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
import { listenTogetherMiddleware } from "@/features/listenTogether/listenTogetherMiddleware";

export const store = configureStore({
  reducer: {
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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(listenTogetherMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
