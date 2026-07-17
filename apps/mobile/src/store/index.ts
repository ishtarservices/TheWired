// ─── Store factory ───────────────────────────────────────────────────
// createStore(adapters) is the shape the desktop's store/index.ts converts to
// at Phase 0 (guide 01 §2) — the 25 desktop slices land here unchanged; the
// adapters ride along as the thunk extra argument so persistence middleware
// and thunks reach the platform without module-level singletons.

import { configureStore } from "@reduxjs/toolkit";

import type { PlatformAdapters } from "@/core/adapters";
import { dmSlice } from "./slices/dmSlice";
import { engagementSlice } from "./slices/engagementSlice";
import { feedSlice } from "./slices/feedSlice";
import { followsSlice } from "./slices/followsSlice";
import { identitySlice } from "./slices/identitySlice";
import { lifecycleSlice } from "./slices/lifecycleSlice";
import { moderationSlice } from "./slices/moderationSlice";
import { profilesSlice } from "./slices/profilesSlice";
import { relaysSlice } from "./slices/relaysSlice";
import { spaceChatSlice } from "./slices/spaceChatSlice";
import { spaceMetaSlice } from "./slices/spaceMetaSlice";
import { spacePreviewsSlice } from "./slices/spacePreviewsSlice";
import { threadsSlice } from "./slices/threadsSlice";
import { zapsSlice } from "./slices/zapsSlice";

export interface ThunkExtra {
  adapters: PlatformAdapters;
}

export function createStore(adapters: PlatformAdapters) {
  return configureStore({
    reducer: {
      identity: identitySlice.reducer,
      relays: relaysSlice.reducer,
      lifecycle: lifecycleSlice.reducer,
      engagement: engagementSlice.reducer,
      feed: feedSlice.reducer,
      follows: followsSlice.reducer,
      profiles: profilesSlice.reducer,
      moderation: moderationSlice.reducer,
      dm: dmSlice.reducer,
      spaceChat: spaceChatSlice.reducer,
      spaceMeta: spaceMetaSlice.reducer,
      spacePreviews: spacePreviewsSlice.reducer,
      threads: threadsSlice.reducer,
      zaps: zapsSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: { extraArgument: { adapters } satisfies ThunkExtra },
      }),
  });
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

/** Hand-written thunk shape — the adapters arrive as the extra argument. */
export type AppThunk<R = void> = (
  dispatch: AppDispatch,
  getState: () => RootState,
  extra: ThunkExtra,
) => R;
