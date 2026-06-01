import { saveUserState, getUserState } from "@/lib/db/userStateStore";
import type { FeatureId } from "@/store/slices/featuresSlice";

/** Per-account list of enabled toggleable features (PACKAGES_DESIGN.md §3). */
const ENABLED_FEATURES_KEY = "enabled_features";

export async function loadEnabledFeatures(): Promise<FeatureId[]> {
  return (await getUserState<FeatureId[]>(ENABLED_FEATURES_KEY)) ?? [];
}

export async function saveEnabledFeatures(features: FeatureId[]): Promise<void> {
  await saveUserState(ENABLED_FEATURES_KEY, features);
}
