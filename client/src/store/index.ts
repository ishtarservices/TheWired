import { configureStore } from "@reduxjs/toolkit";
import { identitySlice } from "./slices/identitySlice";
import { relaysSlice } from "./slices/relaysSlice";
import { spacesSlice } from "./slices/spacesSlice";
import { eventsSlice } from "./slices/eventsSlice";
import { uiSlice } from "./slices/uiSlice";
import { feedSlice } from "./slices/feedSlice";
import { musicSlice } from "./slices/musicSlice";
import { spaceConfigSlice } from "./slices/spaceConfigSlice";

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
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
