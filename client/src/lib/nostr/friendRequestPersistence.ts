import { store } from "@/store";
import {
  restoreFriendRequestState,
  type FriendRequest,
} from "@/store/slices/friendRequestSlice";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const STATE_KEY = "friend_requests";
const DEBOUNCE_MS = 5_000;
const MAX_PERSISTED_WRAP_IDS = 2000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedFriendRequestState {
  requests: FriendRequest[];
  processedWrapIds: string[];
  removedPubkeys?: string[];
}

/** Load persisted friend request state from IndexedDB into Redux */
export async function loadFriendRequestState(): Promise<void> {
  const persisted =
    await getUserState<PersistedFriendRequestState>(STATE_KEY);
  if (!persisted) return;

  store.dispatch(
    restoreFriendRequestState({
      requests: persisted.requests,
      processedWrapIds: persisted.processedWrapIds,
      removedPubkeys: persisted.removedPubkeys ?? [],
    }),
  );
}

/** Debounced save of friend request state to IndexedDB */
function scheduleSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const state = store.getState().friendRequests;

    const persisted: PersistedFriendRequestState = {
      requests: state.requests,
      processedWrapIds: state.processedWrapIds.slice(-MAX_PERSISTED_WRAP_IDS),
      removedPubkeys: state.removedPubkeys,
    };
    saveUserState(STATE_KEY, persisted).catch(() => {});
  }, DEBOUNCE_MS);
}

/** Subscribe to Redux store changes and auto-persist friend request state */
export function startFriendRequestPersistence(): () => void {
  let lastFingerprint = "";

  const unsubscribe = store.subscribe(() => {
    const s = store.getState().friendRequests;
    const wrapIds = s.processedWrapIds;
    const fingerprint = `${s.requests.length}:${wrapIds[wrapIds.length - 1] ?? ""}:${s.removedPubkeys.length}`;

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      scheduleSave();
    }
  });

  return unsubscribe;
}
