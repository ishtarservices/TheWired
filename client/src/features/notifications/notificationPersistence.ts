import { store } from "@/store";
import { restoreNotificationState, type NotificationPreferences, type SpaceMute, type ChannelNotifMode, type SpaceNotifSettings } from "@/store/slices/notificationSlice";
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
  channelNotifSettings: Record<string, ChannelNotifMode>;
  spaceNotifSettings: Record<string, SpaceNotifSettings>;
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
    if (persisted.channelNotifSettings)
      (payload as Record<string, unknown>).channelNotifSettings = persisted.channelNotifSettings;
    if (persisted.spaceNotifSettings)
      (payload as Record<string, unknown>).spaceNotifSettings = persisted.spaceNotifSettings;
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
      channelNotifSettings: state.channelNotifSettings,
      spaceNotifSettings: state.spaceNotifSettings,
    };
    saveUserState(STATE_KEY, persisted).catch(() => {});
    savePreferences(state.preferences);
  }, DEBOUNCE_MS);
}

/** Immediately flush any pending debounced save (used on app close) */
function flushNotificationState(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  const state = store.getState().notifications;
  const persisted: PersistedUnreadState = {
    spaceUnread: state.spaceUnread,
    channelUnread: state.channelUnread,
    spaceMentions: state.spaceMentions,
    channelMentions: state.channelMentions,
    lastReadTimestamps: state.lastReadTimestamps,
    spaceMutes: state.spaceMutes,
    channelNotifSettings: state.channelNotifSettings,
    spaceNotifSettings: state.spaceNotifSettings,
  };
  saveUserState(STATE_KEY, persisted).catch(() => {});
  savePreferences(state.preferences);
}

/** Subscribe to Redux store changes and auto-persist */
export function startNotificationPersistence(): () => void {
  // Track the keys we care about via a simple fingerprint
  let lastFingerprint = "";

  const unsubscribe = store.subscribe(() => {
    const s = store.getState().notifications;
    const fingerprint = `${Object.keys(s.spaceUnread).length}:${Object.keys(s.channelUnread).length}:${Object.keys(s.spaceMutes).length}:${Object.keys(s.channelNotifSettings).length}:${Object.keys(s.spaceNotifSettings).length}:${Object.keys(s.lastReadTimestamps).length}:${s.preferences.enabled}:${s.preferences.dnd}`;

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      scheduleSaveNotificationState();
    }
  });

  // Flush pending save on app close to prevent debounce loss
  const handleBeforeUnload = () => flushNotificationState();
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}
