import { store } from "@/store";
import {
  restoreDMState,
  type DMMessage,
  type DMContact,
} from "@/store/slices/dmSlice";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const DM_STATE_KEY = "dm_state";
const DEBOUNCE_MS = 3_000;
/** Max messages persisted per conversation to avoid unbounded IndexedDB growth */
const MAX_MESSAGES_PER_CONVERSATION = 200;
/** Max processedWrapIds to persist (keeps dedup working across restarts) */
const MAX_PERSISTED_WRAP_IDS = 3000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedDMState {
  messages: Record<string, DMMessage[]>;
  contacts: DMContact[];
  processedWrapIds: string[];
}

/** Load persisted DM state from IndexedDB into Redux */
export async function loadDMState(): Promise<void> {
  const persisted = await getUserState<PersistedDMState>(DM_STATE_KEY);
  if (!persisted) return;

  store.dispatch(
    restoreDMState({
      messages: persisted.messages,
      contacts: persisted.contacts,
      processedWrapIds: persisted.processedWrapIds,
    }),
  );
}

/** Debounced save of DM state to IndexedDB */
function scheduleSaveDMState(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const state = store.getState().dm;

    // Trim messages per conversation to cap storage
    const trimmedMessages: Record<string, DMMessage[]> = {};
    for (const [pubkey, msgs] of Object.entries(state.messages)) {
      trimmedMessages[pubkey] =
        msgs.length > MAX_MESSAGES_PER_CONVERSATION
          ? msgs.slice(-MAX_MESSAGES_PER_CONVERSATION)
          : msgs;
    }

    const persisted: PersistedDMState = {
      messages: trimmedMessages,
      contacts: state.contacts,
      processedWrapIds: state.processedWrapIds.slice(-MAX_PERSISTED_WRAP_IDS),
    };
    saveUserState(DM_STATE_KEY, persisted).catch(() => {});
  }, DEBOUNCE_MS);
}

/** Subscribe to Redux store changes and auto-persist DM state */
export function startDMPersistence(): () => void {
  let lastFingerprint = "";

  const unsubscribe = store.subscribe(() => {
    const s = store.getState().dm;
    // Cheap fingerprint: track message count + contact count + latest wrapId
    const wrapIds = s.processedWrapIds;
    const fingerprint = `${Object.keys(s.messages).length}:${s.contacts.length}:${wrapIds[wrapIds.length - 1] ?? ""}`;

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      scheduleSaveDMState();
    }
  });

  return unsubscribe;
}
