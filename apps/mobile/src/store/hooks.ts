// Typed Redux hooks — always use these instead of the raw react-redux hooks
// (same convention as client/src/store/hooks.ts).

import { useDispatch, useSelector, useStore } from "react-redux";

import type { AppDispatch, AppStore, RootState } from "./index";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
/** Imperative store access for event-time reads (no subscription). */
export const useAppStore = useStore.withTypes<AppStore>();
