// ─── Store factory ───────────────────────────────────────────────────
// createStore(adapters) is the shape the desktop's store/index.ts converts to
// at Phase 0 (guide 01 §2) — the 25 desktop slices land here unchanged; the
// adapters ride along as the thunk extra argument so persistence middleware
// and thunks reach the platform without module-level singletons.

import { configureStore } from "@reduxjs/toolkit";

import type { PlatformAdapters } from "@/core/adapters";
import { identitySlice } from "./slices/identitySlice";
import { lifecycleSlice } from "./slices/lifecycleSlice";
import { relaysSlice } from "./slices/relaysSlice";

export interface ThunkExtra {
  adapters: PlatformAdapters;
}

export function createStore(adapters: PlatformAdapters) {
  return configureStore({
    reducer: {
      identity: identitySlice.reducer,
      relays: relaysSlice.reducer,
      lifecycle: lifecycleSlice.reducer,
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
