import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../index";

/**
 * Toggleable built-in features (PACKAGES_DESIGN.md §3). State is a flat list of
 * enabled feature ids, persisted per-account via `userStateStore`. First-party
 * features add a slice statically; this slice only tracks the on/off set.
 */

/** Stable feature ids. Add new toggleable features here. */
export const FEATURE_DECENTRALIZED_SPACES = "decentralized-spaces";

export type FeatureId = typeof FEATURE_DECENTRALIZED_SPACES;

/** Features enabled by default for every account. */
const DEFAULT_ENABLED: FeatureId[] = [];

interface FeaturesState {
  enabled: FeatureId[];
}

const initialState: FeaturesState = {
  enabled: DEFAULT_ENABLED,
};

export const featuresSlice = createSlice({
  name: "features",
  initialState,
  reducers: {
    /** Replace the whole enabled set (used to hydrate from IndexedDB at login). */
    setEnabledFeatures(state, action: PayloadAction<FeatureId[]>) {
      state.enabled = action.payload;
    },
    setFeatureEnabled(
      state,
      action: PayloadAction<{ feature: FeatureId; enabled: boolean }>,
    ) {
      const { feature, enabled } = action.payload;
      const has = state.enabled.includes(feature);
      if (enabled && !has) state.enabled.push(feature);
      else if (!enabled && has) state.enabled = state.enabled.filter((f) => f !== feature);
    },
  },
});

export const { setEnabledFeatures, setFeatureEnabled } = featuresSlice.actions;

/** Selector: is a given feature enabled for the current account? */
export const selectFeatureEnabled =
  (feature: FeatureId) =>
  (state: RootState): boolean =>
    state.features.enabled.includes(feature);
