import { saveUserState, getUserState } from "@/lib/db/userStateStore";
import { store } from "@/store";
import type { FeedPrefs } from "@/store/slices/feedPrefsSlice";

/** Per-account Feed preferences (toggles + local hidden-accounts list). */
const FEED_PREFS_KEY = "feed_prefs";

const DEFAULTS: FeedPrefs = {
  showReplies: false,
  showReposts: false,
  hiddenPubkeys: [],
};

/** Load stored prefs merged over defaults (forward-compatible with new fields). */
export async function loadFeedPrefs(): Promise<FeedPrefs> {
  const stored = await getUserState<Partial<FeedPrefs>>(FEED_PREFS_KEY);
  return { ...DEFAULTS, ...stored };
}

export async function saveFeedPrefs(prefs: FeedPrefs): Promise<void> {
  await saveUserState(FEED_PREFS_KEY, prefs);
}

/** Persist the current Redux feedPrefs state (call after dispatching a change). */
export function persistCurrentFeedPrefs(): void {
  void saveFeedPrefs(store.getState().feedPrefs);
}
