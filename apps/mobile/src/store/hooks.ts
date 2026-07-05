// Typed Redux hooks — always use these instead of the raw react-redux hooks
// (same convention as client/src/store/hooks.ts).

import { useDispatch, useSelector } from "react-redux";

import type { AppDispatch, RootState } from "./index";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
