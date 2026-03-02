import { store } from "@/store";
import { setKnownFollowers } from "@/store/slices/identitySlice";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const STATE_KEY = "known_followers";
const DEBOUNCE_MS = 5_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Load persisted known followers from IndexedDB into Redux */
export async function loadFollowerState(): Promise<void> {
  const cached = await getUserState<string[]>(STATE_KEY);
  if (cached && cached.length > 0) {
    store.dispatch(setKnownFollowers(cached));
  }
}

/** Debounced save of known followers to IndexedDB */
function scheduleSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const followers = store.getState().identity.knownFollowers;
    saveUserState(STATE_KEY, followers).catch(() => {});
  }, DEBOUNCE_MS);
}

/** Subscribe to Redux store changes and auto-persist follower state */
export function startFollowerPersistence(): () => void {
  let lastCount = store.getState().identity.knownFollowers.length;

  const unsubscribe = store.subscribe(() => {
    const count = store.getState().identity.knownFollowers.length;
    if (count !== lastCount) {
      lastCount = count;
      scheduleSave();
    }
  });

  return unsubscribe;
}
