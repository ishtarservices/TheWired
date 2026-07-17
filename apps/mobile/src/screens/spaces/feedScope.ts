// Guarded parse for the persisted global/follows feed tab (appPrefs owns the
// storage; this owns the shape so a corrupt/legacy value collapses safely).

import type { FeedContext } from "@/store/slices/feedSlice";

export function parseFeedScope(raw: string | null | undefined): FeedContext | null {
  return raw === "global" || raw === "follows" ? raw : null;
}
