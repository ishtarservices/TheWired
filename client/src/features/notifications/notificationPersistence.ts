import { store } from "@/store";
import { restoreNotificationState, type NotificationPreferences, type SpaceMute } from "@/store/slices/notificationSlice";
import { saveUserState, getUserState } from "@/lib/db/userStateStore";

const PREFS_KEY = "notification_preferences";
const STATE_KEY = "notification_unread_state";
const DEBOUNCE_MS = 5_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

interface PersistedUnreadState {
  spaceUnread: Record<string, number>;
  channelUnread: Record<string, number>;
  spaceMentions: Record<string, number>;
  channelMentions: Record<string, number>;
  lastReadTimestamps: Record<string, number>;
  spaceMutes: Record<string, SpaceMute>;
}

// ── Preferences (localStorage for instant sync access) ──────────

export function loadPreferences(): NotificationPreferences | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as NotificationPreferences;
  } catch {
    return null;
  }
}

export function savePreferences(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked — ignore
  }
}

// ── Unread state (IndexedDB via userStateStore) ─────────────────

export async function loadNotificationState(): Promise<void> {
  const [persisted, prefs] = await Promise.all([
    getUserState<PersistedUnreadState>(STATE_KEY),
    Promise.resolve(loadPreferences()),
  ]);

  const payload: Partial<PersistedUnreadState & { preferences: NotificationPreferences }> = {};

  if (persisted) {
    payload.spaceUnread = persisted.spaceUnread;
    payload.channelUnread = persisted.channelUnread;
    payload.spaceMentions = persisted.spaceMentions;
    payload.channelMentions = persisted.channelMentions;
    payload.lastReadTimestamps = persisted.lastReadTimestamps;
    payload.spaceMutes = persisted.spaceMutes;
  }

  if (prefs) {
    payload.preferences = prefs;
  }

  if (Object.keys(payload).length > 0) {
    store.dispatch(restoreNotificationState(payload));
  }
}

/** Debounced save of unread state to IndexedDB */
export function scheduleSaveNotificationState(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const state = store.getState().notifications;
    const persisted: PersistedUnreadState = {
      spaceUnread: state.spaceUnread,
      channelUnread: state.channelUnread,
      spaceMentions: state.spaceMentions,
      channelMentions: state.channelMentions,
      lastReadTimestamps: state.lastReadTimestamps,
      spaceMutes: state.spaceMutes,
    };
    saveUserState(STATE_KEY, persisted).catch(() => {});
    savePreferences(state.preferences);
  }, DEBOUNCE_MS);
}

/** Subscribe to Redux store changes and auto-persist */
export function startNotificationPersistence(): () => void {
  // Track the keys we care about via a simple fingerprint
  let lastFingerprint = "";

  const unsubscribe = store.subscribe(() => {
    const s = store.getState().notifications;
    const fingerprint = `${Object.keys(s.spaceUnread).length}:${Object.keys(s.channelUnread).length}:${Object.keys(s.spaceMutes).length}:${s.preferences.enabled}:${s.preferences.dnd}`;

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      scheduleSaveNotificationState();
    }
  });

  return unsubscribe;
}
